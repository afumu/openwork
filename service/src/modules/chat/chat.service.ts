import {
  buildChatRequestSummary,
  convertUrlToBase64,
  correctApiBaseUrl,
  formatUrl,
  getClientIp,
  getTokenCount,
  removeThinkTags,
  serializeErrorForLog,
  shouldLogProgressHeartbeat,
} from '@/common/utils';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { OpenAI } from 'openai';
import { In, Repository } from 'typeorm';
import { OpenAIChatService } from '../aiTool/chat/chat.service';
import { AppEntity } from '../app/app.entity';
import { AppService } from '../app/app.service';
import { AutoReplyService } from '../autoReply/autoReply.service';
import { BadWordsService } from '../badWords/badWords.service';
import { ChatGroupService } from '../chatGroup/chatGroup.service';
import { ChatLogService } from '../chatLog/chatLog.service';
import {
  buildConversationMemoryBlock,
  buildConversationTaskStateSnapshot,
  chunkMessagesForSummary,
  formatMessagesForSummary,
  parseConversationSummaryMetadata,
  selectMessagesForSummary,
} from './conversationMemory';
import {
  buildAssistantFailureLogUpdate,
  INTERRUPTED_CHAT_MESSAGE,
  looksLikeTransientAssistantFailure,
  shouldTreatAssistantResponseAsInterrupted,
} from './chatPersistence';
import { appendInterruptedSegment, createStreamSegmentCollector } from './chatStreamSegments';
import { configureStreamingResponse, startStreamKeepalive } from './streamKeepalive';
import { GlobalConfigService } from '../globalConfig/globalConfig.service';
import { ModelsService } from '../models/models.service';
import { PluginEntity } from '../plugin/plugin.entity';
import { UploadService } from '../upload/upload.service';
import { UserService } from '../user/user.service';
import { UserBalanceService } from '../userBalance/userBalance.service';

type ChatStreamProgressStats = {
  progressEventCount: number;
  contentChunkCount: number;
  reasoningChunkCount: number;
  toolCallChunkCount: number;
  toolExecutionChunkCount: number;
  contentChars: number;
  reasoningChars: number;
  firstProgressAt: number | null;
  lastProgressAt: number | null;
  lastProgressLogAt: number;
};

type ActiveChatAbortEntry = {
  abortController: AbortController;
  assistantLogId: number | null;
  createdAt: number;
  traceId: string;
};

type ChatArtifactFileItem = {
  name: string;
  path: string;
  preview?: string;
  size: number;
  type: string;
  updatedAt: string;
  runId: string | null;
  source?: string;
};

@Injectable()
export class ChatService {
  private readonly activeChatAbortControllers = new Map<string, Set<ActiveChatAbortEntry>>();

  constructor(
    @InjectRepository(AppEntity)
    private readonly appEntity: Repository<AppEntity>,
    @InjectRepository(PluginEntity)
    private readonly pluginEntity: Repository<PluginEntity>,
    private readonly openAIChatService: OpenAIChatService,
    private readonly chatLogService: ChatLogService,
    private readonly userBalanceService: UserBalanceService,
    private readonly userService: UserService,
    private readonly uploadService: UploadService,
    private readonly badWordsService: BadWordsService,
    private readonly autoReplyService: AutoReplyService,
    private readonly globalConfigService: GlobalConfigService,
    private readonly chatGroupService: ChatGroupService,
    private readonly modelsService: ModelsService,
    private readonly appService: AppService,
  ) {}

  private createTraceId(userId?: string | number, groupId?: string | number) {
    return `chat-${Date.now()}-${userId || 'anonymous'}-${groupId || 'nogroup'}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private logTrace(
    level: 'log' | 'debug' | 'warn' | 'error',
    traceId: string,
    message: string,
    context?: Record<string, any>,
  ) {
    const suffix = context ? ` | ${JSON.stringify(context)}` : '';
    const content = `[traceId=${traceId}] ${message}${suffix}`;

    if (level === 'error') {
      Logger.error(content, undefined, 'ChatService');
      return;
    }

    if (level === 'warn') {
      Logger.warn(content, 'ChatService');
      return;
    }

    if (level === 'log') {
      Logger.log(content, 'ChatService');
      return;
    }

    Logger.debug(content, 'ChatService');
  }

  private getStreamProgressSnapshot(
    stats: ChatStreamProgressStats,
    now: number,
    requestStartedAt: number,
  ) {
    return {
      progressEventCount: stats.progressEventCount,
      contentChunkCount: stats.contentChunkCount,
      reasoningChunkCount: stats.reasoningChunkCount,
      toolCallChunkCount: stats.toolCallChunkCount,
      toolExecutionChunkCount: stats.toolExecutionChunkCount,
      contentChars: stats.contentChars,
      reasoningChars: stats.reasoningChars,
      firstProgressDelayMs: stats.firstProgressAt ? stats.firstProgressAt - requestStartedAt : null,
      lastProgressAgoMs: stats.lastProgressAt ? now - stats.lastProgressAt : null,
    };
  }

  private buildSessionId(groupId?: number | null, chatId?: number | null) {
    if (groupId) {
      return `group-${groupId}`;
    }
    if (chatId) {
      return `chat-${chatId}`;
    }
    return null;
  }

  private flattenArtifactManifestFiles(manifest: any): ChatArtifactFileItem[] {
    if (!manifest || typeof manifest !== 'object') return [];

    if (Array.isArray(manifest.workspaceFiles)) {
      return manifest.workspaceFiles
        .filter(file => file && typeof file === 'object' && file.path)
        .map(file => ({
          name: String(file.name || String(file.path).split('/').pop() || 'file'),
          path: String(file.path),
          preview: typeof file.preview === 'string' ? file.preview : undefined,
          size: Number(file.size || 0),
          type: String(file.type || 'unknown'),
          updatedAt: String(file.updatedAt || ''),
          runId: file.runId ? String(file.runId) : null,
          source: file.source ? String(file.source) : undefined,
        }));
    }

    if (!Array.isArray(manifest.runs)) return [];

    return manifest.runs.flatMap(run => {
      if (!run || typeof run !== 'object' || !Array.isArray(run.files)) return [];
      const runId = String(run.runId || '');
      const source = String(run.source || '');

      return run.files
        .filter(file => file && typeof file === 'object' && file.path)
        .map(file => ({
          name: String(file.name || String(file.path).split('/').pop() || 'file'),
          path:
            source === 'artifacts_root'
              ? `data/${runId}/${String(file.path)}`
              : `${runId}/${String(file.path)}`,
          preview: typeof file.preview === 'string' ? file.preview : undefined,
          size: Number(file.size || 0),
          type: String(file.type || 'unknown'),
          updatedAt: String(file.updatedAt || ''),
          runId: runId || null,
          source: source || undefined,
        }));
    });
  }

  private buildArtifactSnapshot(files: ChatArtifactFileItem[]) {
    return new Map(files.map(file => [file.path, `${file.updatedAt}:${file.size}`]));
  }

  private diffArtifactFiles(
    before: Map<string, string>,
    after: ChatArtifactFileItem[],
  ): ChatArtifactFileItem[] {
    return after.filter(file => before.get(file.path) !== `${file.updatedAt}:${file.size}`);
  }

  private async safeListConversationArtifactFiles(
    userId: number,
    groupId: number | undefined,
    traceId: string,
    stage: 'before' | 'after',
  ): Promise<ChatArtifactFileItem[]> {
    if (!groupId) return [];

    try {
      const manifest = await this.openAIChatService.listArtifacts(userId, groupId, traceId);
      return this.flattenArtifactManifestFiles(manifest);
    } catch (error) {
      this.logTrace('warn', traceId, '查询对话产物快照失败，继续聊天流程', {
        error: serializeErrorForLog(error),
        groupId,
        stage,
        userId,
      });
      return [];
    }
  }

  private registerActiveChatAbort(
    sessionId: string,
    entry: ActiveChatAbortEntry,
    context?: Record<string, any>,
  ) {
    const entries =
      this.activeChatAbortControllers.get(sessionId) ?? new Set<ActiveChatAbortEntry>();
    entries.add(entry);
    this.activeChatAbortControllers.set(sessionId, entries);
    this.logTrace('debug', entry.traceId, '已注册活动聊天中断控制器', {
      activeRequestCount: entries.size,
      assistantLogId: entry.assistantLogId,
      sessionId,
      ...context,
    });
  }

  private unregisterActiveChatAbort(sessionId: string | null, entry: ActiveChatAbortEntry) {
    if (!sessionId) {
      return;
    }

    const entries = this.activeChatAbortControllers.get(sessionId);
    if (!entries) {
      return;
    }

    entries.delete(entry);
    if (entries.size === 0) {
      this.activeChatAbortControllers.delete(sessionId);
      return;
    }

    this.activeChatAbortControllers.set(sessionId, entries);
  }

  async stopChat(body: { groupId?: number; chatId?: number }, req?: Request) {
    const traceId = this.createTraceId(req?.user?.id, body?.groupId);
    const sessionId = this.buildSessionId(body?.groupId, body?.chatId);

    if (!sessionId) {
      this.logTrace('warn', traceId, '停止聊天请求缺少 session 标识', {
        chatId: body?.chatId ?? null,
        groupId: body?.groupId ?? null,
      });
      throw new HttpException('缺少可停止的会话标识', HttpStatus.BAD_REQUEST);
    }

    const activeEntries = this.activeChatAbortControllers.get(sessionId);
    let abortedRequestCount = 0;
    if (activeEntries?.size) {
      for (const entry of [...activeEntries]) {
        if (!entry.abortController.signal.aborted) {
          entry.abortController.abort();
          abortedRequestCount += 1;
        }
      }
    }

    const piAbort = await this.openAIChatService.abortPiSession(
      sessionId,
      req?.user?.id,
      body?.groupId || (body?.chatId ? `chat-${body.chatId}` : sessionId),
      traceId,
    );
    this.logTrace('log', traceId, '收到停止聊天请求并已尝试中断', {
      abortedRequestCount,
      chatId: body?.chatId ?? null,
      groupId: body?.groupId ?? null,
      piAbort,
      sessionId,
    });

    return {
      abortedRequestCount,
      piAbort,
      sessionId,
      success: true,
    };
  }

  async listArtifacts(body: { groupId?: number }, req?: Request) {
    const traceId = this.createTraceId(req?.user?.id, body?.groupId);
    const groupId = Number(body?.groupId || 0);

    if (!groupId) {
      throw new HttpException('缺少 groupId', HttpStatus.BAD_REQUEST);
    }

    this.logTrace('debug', traceId, '开始查询当前对话产物列表', {
      groupId,
      userId: req?.user?.id ?? null,
    });

    try {
      const data = await this.openAIChatService.listArtifacts(req.user.id, groupId, traceId);
      return {
        data,
        success: true,
      };
    } catch (error) {
      this.logTrace('error', traceId, '查询当前对话产物列表失败', {
        error: serializeErrorForLog(error),
        groupId,
        userId: req?.user?.id ?? null,
      });
      throw error;
    }
  }

  async readArtifact(body: { groupId?: number; runId?: string; path?: string }, req?: Request) {
    const traceId = this.createTraceId(req?.user?.id, body?.groupId);
    const groupId = Number(body?.groupId || 0);
    const runId = body?.runId ? String(body.runId).trim() : '';
    const artifactPath = String(body?.path || '').trim();

    if (!groupId || !artifactPath) {
      throw new HttpException('缺少必要的产物读取参数', HttpStatus.BAD_REQUEST);
    }

    this.logTrace('debug', traceId, '开始读取当前对话产物文件', {
      artifactPath,
      groupId,
      runId: runId || null,
      userId: req?.user?.id ?? null,
    });

    try {
      const data = await this.openAIChatService.readArtifact(
        req.user.id,
        groupId,
        runId || undefined,
        artifactPath,
        traceId,
      );

      return {
        data,
        success: true,
      };
    } catch (error) {
      this.logTrace('error', traceId, '读取当前对话产物文件失败', {
        artifactPath,
        error: serializeErrorForLog(error),
        groupId,
        runId: runId || null,
        userId: req?.user?.id ?? null,
      });
      throw error;
    }
  }

  async chatProcess(body: any, req?: Request, res?: Response) {
    await this.userBalanceService.checkUserCertification(req.user.id);
    /* 获取对话参数 */
    const {
      options = {},
      usingPluginId,
      appId = null,
      prompt,
      fileUrl,
      imageUrl,
      extraParam,
      model,
      action,
      modelName,
      modelAvatar,
    } = body;

    const traceId = this.createTraceId(req?.user?.id, options?.groupId);
    const requestStartedAt = Date.now();
    const streamProgress: ChatStreamProgressStats = {
      progressEventCount: 0,
      contentChunkCount: 0,
      reasoningChunkCount: 0,
      toolCallChunkCount: 0,
      toolExecutionChunkCount: 0,
      contentChars: 0,
      reasoningChars: 0,
      firstProgressAt: null,
      lastProgressAt: null,
      lastProgressLogAt: requestStartedAt,
    };
    let abortReason = 'not_aborted';
    let assistantLogId: number | null = null;
    let hasWrittenInitialChatId = false;
    let stopStreamKeepalive: () => void = () => undefined;
    let partialAssistantContent = '';
    let partialAssistantReasoning = '';
    let partialToolCalls = '';
    let partialToolExecution = '';
    let partialNetworkSearchResult = '';
    let partialFileVectorResult = '';
    let lastPartialPersistAt = 0;
    let lastPartialPersistChars = 0;
    let partialPersistQueue: Promise<any> = Promise.resolve();
    const streamSegmentCollector = createStreamSegmentCollector();
    let hasMarkedClientInterrupted = false;

    const persistPartialAssistantLog = async (force = false) => {
      if (!assistantLogId) {
        return partialPersistQueue;
      }

      const streamSegments = streamSegmentCollector.serialize();
      const totalChars =
        partialAssistantContent.length +
        partialAssistantReasoning.length +
        partialToolCalls.length +
        partialToolExecution.length +
        partialNetworkSearchResult.length +
        partialFileVectorResult.length +
        streamSegments.length;
      if (totalChars === 0) {
        return partialPersistQueue;
      }

      const now = Date.now();
      if (
        !force &&
        now - lastPartialPersistAt < 5000 &&
        totalChars - lastPartialPersistChars < 800
      ) {
        return partialPersistQueue;
      }

      lastPartialPersistAt = now;
      lastPartialPersistChars = totalChars;
      const update: Record<string, any> = {
        status: 2,
      };
      if (partialAssistantContent) {
        update.content = partialAssistantContent;
      }
      if (partialAssistantReasoning) {
        update.reasoning_content = partialAssistantReasoning;
      }
      if (partialToolCalls) {
        update.tool_calls = partialToolCalls;
      }
      if (partialToolExecution) {
        update.tool_execution = partialToolExecution;
      }
      if (streamSegments) {
        update.stream_segments = streamSegments;
      }
      if (partialNetworkSearchResult) {
        update.networkSearchResult = partialNetworkSearchResult;
      }
      if (partialFileVectorResult) {
        update.fileVectorResult = partialFileVectorResult;
      }

      partialPersistQueue = partialPersistQueue
        .catch(() => undefined)
        .then(() => this.chatLogService.updateChatLog(assistantLogId, update))
        .catch(error => {
          this.logTrace('warn', traceId, '流式部分内容落库失败，继续聊天流程', {
            assistantLogId,
            error: serializeErrorForLog(error),
            partialChars: totalChars,
          });
        });

      return partialPersistQueue;
    };

    const markClientInterruptedLog = (source: string) => {
      if (hasMarkedClientInterrupted) {
        return;
      }
      hasMarkedClientInterrupted = true;
      appendInterruptedSegment(streamSegmentCollector);
      void persistPartialAssistantLog(true)
        .then(() =>
          assistantLogId
            ? this.chatLogService.updateChatLog(assistantLogId, {
                status: 4,
                content: partialAssistantContent || INTERRUPTED_CHAT_MESSAGE,
                reasoning_content: partialAssistantReasoning || undefined,
                stream_segments: streamSegmentCollector.serialize(),
              })
            : undefined,
        )
        .catch(error => {
          this.logTrace('warn', traceId, '客户端断开后的中断状态落库失败', {
            assistantLogId,
            error: serializeErrorForLog(error),
            source,
          });
        });
    };

    Logger.debug(
      `body summary: ${JSON.stringify({
        action,
        appId,
        fileCount: fileUrl ? 1 : 0,
        hasExtraParam: Boolean(extraParam),
        imageCount: imageUrl ? String(imageUrl).split(',').filter(Boolean).length : 0,
        model,
        optionKeys: Object.keys(options || {}),
        promptLength: prompt?.length || 0,
        usingPluginId: usingPluginId || null,
      })}`,
      'ChatService',
    );
    this.logTrace(
      'log',
      traceId,
      '收到聊天请求',
      buildChatRequestSummary({
        action,
        appId,
        extraParam,
        fileUrl,
        groupId: options?.groupId,
        imageUrl,
        model,
        prompt,
        userId: req?.user?.id,
        usingDeepThinking: options?.usingDeepThinking,
        researchMode: options?.researchMode,
        usingMcpTool: options?.usingMcpTool,
        usingNetwork: options?.usingNetwork,
      }),
    );

    // 获取应用信息
    let appInfo;
    if (appId) {
      Logger.debug(`正在使用应用ID: ${appId}`);
      appInfo = await this.appEntity.findOne({
        where: { id: appId, status: In([1, 3, 4, 5]) },
      });

      if (!appInfo) {
        throw new HttpException(
          '你当前使用的应用已被下架、请删除当前对话开启新的对话吧！',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 检查应用是否为会员专属
      const isAppMemberOnly = await this.appService.checkAppIsMemberOnly(Number(appId));
      if (isAppMemberOnly) {
        Logger.debug(`检测到会员专属应用: ${isAppMemberOnly}`);
        const userCatIds = await this.userBalanceService.getUserApps(req.user.id);
        Logger.debug(`用户权限分类: ${userCatIds.join(',')}`);

        // 获取应用所属的分类ID列表
        const appCatIds = appInfo.catId.split(',').map(id => id.trim());
        Logger.debug(`应用所属分类: ${appCatIds.join(',')}`);

        const hasMatchingCategory = appCatIds.some(catId => userCatIds.includes(catId));

        if (!hasMatchingCategory) {
          throw new HttpException(
            '你当前使用的应用为会员专属应用，请先开通会员！',
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
      }
    }

    const { groupId, usingNetwork, usingDeepThinking, researchMode, usingMcpTool } = options;
    let sessionId = this.buildSessionId(groupId, null);

    const {
      openaiBaseUrl,
      openaiBaseKey,
      systemPreMessage,
      openaiTemperature,
      openaiBaseModel,
      isGeneratePromptReference,
      isConvertToBase64,
      isSensitiveWordFilter,
    } = await this.globalConfigService.getConfigs([
      'openaiBaseUrl',
      'openaiBaseKey',
      'systemPreMessage',
      'openaiTemperature',
      'openaiBaseModel',
      'isGeneratePromptReference',
      'isConvertToBase64',
      'isSensitiveWordFilter',
    ]);

    /* 检测用户状态 */
    await this.userService.checkUserStatus(req.user);

    /* 敏感词检测 */
    // 检查敏感词汇
    if (isSensitiveWordFilter === '1') {
      const triggeredWords = await this.badWordsService.checkBadWords(prompt, req.user.id);
      if (triggeredWords.length > 0) {
        // 如果返回的数组不为空
        const tips = `您提交的信息中包含违规的内容，我们已对您的账户进行标记，请合规使用！`;
        throw new HttpException(tips, HttpStatus.BAD_REQUEST);
      }
    }

    /* 自动回复 */
    const autoReplyRes = await this.autoReplyService.checkAutoReply(prompt);
    Logger.debug(
      `自动回复检查结果: ${JSON.stringify({
        answerLength: autoReplyRes?.answer?.length || 0,
        hasAnswer: Boolean(autoReplyRes?.answer),
        isAIReplyEnabled: autoReplyRes?.isAIReplyEnabled,
      })}`,
      'ChatService',
    );

    /* 设置对话变量 */
    let currentRequestModelKey = null;
    let appName = '';
    let setSystemMessage = '';
    const curIp = getClientIp(req);
    let useModelAvatar = '';
    let usingPlugin;

    if (usingPluginId) {
      Logger.debug(`使用插件ID: ${usingPluginId}`, 'ChatService');
      if (usingPluginId === 999) {
        usingPlugin = {
          parameters: 'mermaid',
        };
      }
    }

    /* 获取模型配置及预设设置 */
    if (appInfo) {
      const { isGPTs, gizmoID, name, isFixedModel, appModel, coverImg } = appInfo;
      useModelAvatar = coverImg;
      appName = name;
      if (isGPTs) {
        currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo('gpts');
        currentRequestModelKey.model = `gpt-4-gizmo-${gizmoID}`;
      } else if (!isGPTs && isFixedModel && appModel) {
        appInfo.preset && (setSystemMessage = appInfo.preset);
        currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo(appModel);
        currentRequestModelKey.model = appModel;
        Logger.debug(`使用固定模型和应用预设`, 'ChatService');
      } else {
        // 使用应用预设
        appInfo.preset && (setSystemMessage = appInfo.preset);
        currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo(model);
        Logger.debug(`使用应用预设模式`, 'ChatService');
      }
    } else {
      if (usingPlugin?.parameters === 'mermaid') {
        setSystemMessage = `
{
"title": "Mermaid专业图表大师",
"description": "智能多类型Mermaid图表生成专家",

## 角色定位
你是一位精通Mermaid语法的专业图表设计师，具备将复杂信息转化为清晰可视化图表的卓越能力。你不仅掌握所有Mermaid图表类型，还能根据用户需求智能选择最优图表方案。

## 核心能力矩阵

### 流程与逻辑类
- **流程图(flowchart)**: 展示流程、决策和系统工作流
- **时序图(sequenceDiagram)**: 描述对象间的交互顺序
- **状态图(stateDiagram)**: 展示状态转换和生命周期
- **用户旅程图(journey)**: 可视化用户体验历程

### 结构与关系类
- **类图(classDiagram)**: UML类结构和继承关系
- **实体关系图(erDiagram)**: 数据库实体关系建模
- **C4图(C4Context等)**: 软件架构多层次视图
- **思维导图(mindmap)**: 思维结构和概念关联

### 时间与进度类
- **甘特图(gantt)**: 项目进度和时间规划
- **时间线图(timeline)**: 历史事件和里程碑
- **Gitgraph图(gitGraph)**: Git版本控制历史

### 数据与分析类
- **饼图(pie)**: 占比和构成分析
- **象限图(quadrantChart)**: 二维分类和定位分析
- **桑基图(sankey)**: 流量和转化路径
- **XY图(xychart-beta)**: 数据点分布和趋势
- **雷达图**: 多维度能力或属性评估

### 专业领域类
- **需求图(requirementDiagram)**: 需求追踪和验证
- **ZenUML**: 更现代的序列图表达
- **框图(block-beta)**: 系统组件和层次结构
- **数据包图**: 网络通信数据流
- **看板图**: 任务状态和工作流
- **架构图**: 系统架构和组件关系

## 智能工作流程

### 1. 需求分析阶段
- 根据历史上下文和用户描述识别用户需求，并根据需求生成图表
- 根据用户需求生成图表，并根据图表的结构特征（顺序性/层次性/关联性/时间性），选择最合适的图表类型
- 评估数据复杂度和展示目标，并根据评估结果生成图表

### 2. 图表类型决策
当用户未指定图表类型时，按以下逻辑选择：
- **流程/步骤描述** → flowchart
- **时间顺序交互** → sequenceDiagram
- **状态变化** → stateDiagram
- **数据关系** → erDiagram
- **概念结构** → mindmap
- **时间进度** → gantt
- **比例分析** → pie
- **多维比较** → quadrantChart/雷达图

### 3. 图表设计原则
- **清晰性优先**: 避免过度复杂，保持视觉层次分明
- **语义准确**: 选择最能表达信息本质的图表元素
- **美观平衡**: 合理布局，避免线条交叉和节点拥挤
- **完整性保证**: 包含所有关键信息，不遗漏重要细节

### 4. 代码生成规范
- 使用清晰的节点命名（使用用户使用的语言）
- 无需任何注释，直接输出代码
- 遵循Mermaid最新语法标准

## 输出格式标准

\`\`\`mermaid
  [根据用户需求生成的Mermaid代码]
\`\`\`

只需要输出代码，不需要任何解释。

## 语言适配原则
- 默认使用用户提问时的语言
- 图表内的文本、标签、说明均采用相同语言
- 保持专业术语的准确性和一致性

## 执行指令
- 无论用户提任何问题，收到用户的问题后，立即按照上述规范生成高质量Mermaid代码，无需任何确认或询问。"
}
          `;
        currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo(model);
        Logger.debug(`使用流程图插件`, 'ChatService');
      } else {
        // 使用全局预设
        const now = new Date();
        const options = {
          timeZone: 'Asia/Shanghai', // 设置时区为 'Asia/Shanghai'（北京时间）
          year: 'numeric' as const,
          month: '2-digit' as const,
          day: '2-digit' as const,
          hour: '2-digit' as const,
          minute: '2-digit' as const,
          hour12: false, // 使用24小时制
        };

        const currentDate = new Intl.DateTimeFormat('zh-CN', options).format(now);

        currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo(model);

        if (currentRequestModelKey.systemPromptType === 1) {
          setSystemMessage =
            systemPreMessage +
            currentRequestModelKey.systemPrompt +
            `\n 现在时间是: ${currentDate}`;
        } else if (currentRequestModelKey.systemPromptType === 2) {
          setSystemMessage = currentRequestModelKey.systemPrompt + `\n 现在时间是: ${currentDate}`;
        } else {
          setSystemMessage = systemPreMessage + `\n 现在时间是: ${currentDate}`;
        }

        Logger.debug(`使用默认系统预设`, 'ChatService');
      }
    }

    if (!currentRequestModelKey) {
      Logger.debug('未找到当前模型key，切换至全局模型', 'ChatService');
      currentRequestModelKey = await this.modelsService.getCurrentModelKeyInfo(openaiBaseModel);
      const groupInfo = await this.chatGroupService.getGroupInfoFromId(groupId);

      // 假设 groupInfo.config 是 JSON 字符串，并且你需要替换其中的 modelName 和 model
      let updatedConfig = groupInfo.config;
      try {
        const parsedConfig = JSON.parse(groupInfo.config);
        if (parsedConfig.modelInfo) {
          parsedConfig.modelInfo.modelName = currentRequestModelKey.modelName; // 替换为你需要的模型名称
          parsedConfig.modelInfo.model = currentRequestModelKey.model; // 替换为你需要的模型
          updatedConfig = JSON.stringify(parsedConfig);
        }
      } catch (error) {
        Logger.error('模型配置解析失败', error);
        throw new HttpException('配置解析错误！', HttpStatus.BAD_REQUEST);
      }

      await this.chatGroupService.update(
        {
          groupId,
          title: groupInfo.title,
          isSticky: false,
          config: updatedConfig,
          fileUrl: fileUrl,
        },
        req,
      );
    }

    const {
      deduct,
      isTokenBased,
      tokenFeeRatio,
      deductType,
      key,
      id: keyId,
      maxRounds,
      proxyUrl,
      maxModelTokens,
      max_tokens,
      timeout,
      model: useModel,
      isFileUpload,
      isImageUpload,
      keyType: modelType,
      deductDeepThink = 1,
      isMcpTool,
      deepThinkingType,
      drawingType,
    } = currentRequestModelKey;

    if (await this.chatLogService.checkModelLimits(req.user, useModel)) {
      res.write(
        `\n${JSON.stringify({
          status: 3,
          content: '1 小时内对话次数过多，请切换模型或稍后再试！',
          modelType: modelType,
        })}`,
      );
      res.end();
      return;
    }

    // 检测用户余额
    await this.userBalanceService.validateBalance(
      req,
      deductType,
      deduct * (usingDeepThinking ? deductDeepThink : 1),
    );

    // 整理对话参数
    const useModeName = modelName;
    const proxyResUrl = formatUrl(proxyUrl || openaiBaseUrl || 'https://api.openai.com');

    const modelKey = key || openaiBaseKey;
    const modelTimeout = (timeout || 300) * 1000;
    const temperature = Number(openaiTemperature) || 1;
    let promptReference = '';

    this.logTrace('debug', traceId, '模型与请求配置已解析', {
      chargeType: deductType,
      isFileUpload,
      isImageUpload,
      keyId,
      maxModelTokens,
      maxRounds,
      maxTokens: max_tokens,
      modelTimeout,
      modelType,
      proxyResUrl,
      resolvedModel: useModel,
      useModeName,
      usingDeepThinking: Boolean(usingDeepThinking),
      researchMode: Boolean(researchMode),
      usingMcpTool: Boolean(usingMcpTool),
      usingNetwork: Boolean(usingNetwork),
    });

    if (groupId) {
      const groupInfo = await this.chatGroupService.getGroupInfoFromId(groupId);
      this.updateChatTitle(groupId, groupInfo, modelType, prompt, req); // Call without await
      await this.chatGroupService.updateTime(groupId);
    }

    const userSaveLog = await this.chatLogService.saveChatLog({
      appId: appId,
      curIp,
      userId: req.user.id,
      type: modelType ? modelType : 1,
      fileUrl: fileUrl ? fileUrl : null,
      imageUrl: imageUrl ? imageUrl : null,
      content: prompt,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: useModel,
      modelName: '我',
      role: 'user',
      groupId: groupId ? groupId : null,
    });

    const assistantSaveLog = await this.chatLogService.saveChatLog({
      appId: appId ? appId : null,
      action: action ? action : null,
      curIp,
      userId: req.user.id,
      type: modelType ? modelType : 1,
      progress: '0%',
      model: useModel,
      modelName: useModeName,
      role: 'assistant',
      groupId: groupId ? groupId : null,
      status: 2,
      modelAvatar: usingPlugin?.pluginImg || useModelAvatar || modelAvatar || '',
      pluginParam: usingPlugin?.parameters
        ? usingPlugin.parameters
        : modelType === 2
        ? useModel
        : null,
    });
    const userLogId = userSaveLog.id;
    assistantLogId = assistantSaveLog.id;

    if (res) {
      configureStreamingResponse(res);
      stopStreamKeepalive = startStreamKeepalive(res);
    }

    const writeInitialChatIdIfNeeded = () => {
      if (!res || hasWrittenInitialChatId || !assistantLogId) return;

      res.write(
        `\n${JSON.stringify({
          chatId: assistantLogId,
        })}`,
      );
      hasWrittenInitialChatId = true;
    };

    const writeStreamPayload = (payload: Record<string, any>) => {
      if (!res) return;

      writeInitialChatIdIfNeeded();
      res.write(`\n${JSON.stringify(payload)}`);
    };

    this.logTrace('debug', traceId, '聊天日志记录已创建', {
      assistantLogId,
      groupId: groupId || null,
      userLogId,
    });

    const artifactSnapshotBefore = this.buildArtifactSnapshot(
      await this.safeListConversationArtifactFiles(req.user.id, groupId, traceId, 'before'),
    );

    if (autoReplyRes.answer && res) {
      if (autoReplyRes.isAIReplyEnabled === 0) {
        const chars = autoReplyRes.answer.split('');
        // 使用一个递归函数来逐个字符发送响应
        const sendCharByChar = index => {
          if (index < chars.length) {
            const msg = { text: chars[index] }; // 封装当前字符为对象
            res.write(`${JSON.stringify(msg)}\n`); // 发送当前字符
            setTimeout(() => sendCharByChar(index + 1), 10); // 设置定时器递归调用
          } else {
            res.end(); // 所有字符发送完毕，结束响应
          }
        };

        // 从第一个字符开始发送
        sendCharByChar(0);
        await this.chatLogService.updateChatLog(assistantLogId, {
          content: autoReplyRes.answer,
        });
        return;
      } else {
        setSystemMessage = setSystemMessage + autoReplyRes.answer;
      }
    }

    /* 获取历史消息 */
    const messageBuildStartAt = Date.now();
    const { messagesHistory } = await this.buildMessageFromParentMessageId(
      {
        groupId,
        systemMessage: setSystemMessage,
        maxModelTokens,
        maxRounds: maxRounds,
        isConvertToBase64: isConvertToBase64,
        fileUrl: fileUrl,
        imageUrl: imageUrl,
        model: useModel,
        isFileUpload,
        isImageUpload,
        summaryModelConfig: {
          apiKey: modelKey,
          model: useModel,
          proxyUrl: proxyResUrl,
          timeout: modelTimeout,
        },
        onContextCompressionProgress: event => {
          writeStreamPayload({
            tool_execution_delta: {
              tool_call_id: 'context-compression',
              tool_name: 'context_compression',
              event: event.event,
              phase: event.phase,
              kind: 'workflow_step',
              step: 'context_compression',
              display_title: event.title,
              display_subtitle: event.message,
              progress: event.progress,
              is_error: event.isError || false,
              result_preview: event.resultPreview,
            },
          });
        },
      },
      this.chatLogService,
    );
    this.logTrace('debug', traceId, '消息历史构建完成', {
      durationMs: Date.now() - messageBuildStartAt,
      messageCount: messagesHistory.length,
      roles: messagesHistory.map(message => message.role),
    });

    /* 单独处理 MJ 积分的扣费 */
    let charge;
    if (action !== 'UPSCALE' && useModel === 'midjourney') {
      if (prompt.includes('--v 7')) {
        charge = deduct * 8;
      } else if (prompt.includes('--draft')) {
        charge = deduct * 2;
      } else {
        charge = deduct * 4;
      }
    } else {
      charge = deduct * (usingDeepThinking ? deductDeepThink : 1);
    }

    const abortController = new AbortController();
    const activeAbortEntry: ActiveChatAbortEntry = {
      abortController,
      assistantLogId,
      createdAt: requestStartedAt,
      traceId,
    };
    if (sessionId) {
      this.registerActiveChatAbort(sessionId, activeAbortEntry, {
        groupId,
      });
    }
    abortController.signal.addEventListener(
      'abort',
      () => {
        this.logTrace('warn', traceId, 'AbortController 已触发', {
          abortReason,
          assistantLogId,
          durationMs: Date.now() - requestStartedAt,
          signalAborted: abortController.signal.aborted,
          streamProgress: this.getStreamProgressSnapshot(
            streamProgress,
            Date.now(),
            requestStartedAt,
          ),
        });
      },
      { once: true },
    );

    /* 处理对话  */
    try {
      if (res) {
        req?.on('aborted', () => {
          abortReason = 'request.aborted';
          markClientInterruptedLog('request.aborted');
          this.logTrace('warn', traceId, '客户端请求已中止(req.aborted)', {
            assistantLogId,
            durationMs: Date.now() - requestStartedAt,
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
          });
        });

        res.on('finish', () => {
          this.logTrace('debug', traceId, '响应流 finish', {
            assistantLogId,
            durationMs: Date.now() - requestStartedAt,
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
            writableEnded: res.writableEnded,
          });
        });

        res.on('error', error => {
          this.logTrace('error', traceId, '响应流发生错误', {
            assistantLogId,
            durationMs: Date.now() - requestStartedAt,
            error: serializeErrorForLog(error),
          });
        });

        res.on('close', () => {
          const shouldAbort =
            !abortController.signal.aborted && (!res.writableEnded || req?.aborted);
          abortReason = shouldAbort ? 'response.close' : abortReason;
          this.logTrace('warn', traceId, '响应连接关闭(res.close)', {
            abortedBeforeClose: abortController.signal.aborted,
            assistantLogId,
            durationMs: Date.now() - requestStartedAt,
            requestAborted: req?.aborted,
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
            writableEnded: res.writableEnded,
          });
          if (shouldAbort) {
            markClientInterruptedLog('response.close');
            abortController.abort();
          }
        });

        let response;
        try {
          let chatId = {
            chatId: assistantLogId,
          };
          activeAbortEntry.assistantLogId = assistantLogId;
          if (!sessionId && assistantLogId) {
            sessionId = this.buildSessionId(groupId, assistantLogId);
            if (sessionId) {
              this.registerActiveChatAbort(sessionId, activeAbortEntry, {
                groupId,
                registeredAfterChatId: true,
              });
            }
          }

          this.logTrace('debug', traceId, '开始向客户端写入 chatId 并调用下游聊天服务', {
            assistantLogId,
            chatIdPayload: chatId,
            durationMs: Date.now() - requestStartedAt,
          });
          writeInitialChatIdIfNeeded();

          /* 普通对话 */
          const downstreamStartedAt = Date.now();
          response = await this.openAIChatService.chat(messagesHistory, {
            chatId: assistantLogId,
            groupId,
            userId: req.user.id,
            extraParam,
            deepThinkingType,
            max_tokens: max_tokens,
            apiKey: modelKey,
            model: useModel,
            modelName: useModeName,
            temperature,
            isImageUpload,
            prompt,
            imageUrl,
            isFileUpload,
            fileUrl,
            usingNetwork,
            timeout: modelTimeout,
            proxyUrl: proxyResUrl,
            modelAvatar: modelAvatar,
            usingDeepThinking: usingDeepThinking,
            researchMode,
            usingMcpTool: usingMcpTool,
            isMcpTool: isMcpTool,
            onProgress: chat => {
              const now = Date.now();
              const contentText = Array.isArray(chat?.content)
                ? chat.content.map((item: any) => item?.text || '').join('')
                : '';
              const reasoningText = Array.isArray(chat?.reasoning_content)
                ? chat.reasoning_content.map((item: any) => item?.text || '').join('')
                : '';
              const chatPayload = chat as any;

              streamProgress.progressEventCount += 1;
              if (contentText) {
                streamProgress.contentChunkCount += 1;
                streamProgress.contentChars += contentText.length;
                partialAssistantContent += contentText;
                streamSegmentCollector.appendText(contentText);
              }
              if (reasoningText) {
                streamProgress.reasoningChunkCount += 1;
                streamProgress.reasoningChars += reasoningText.length;
                partialAssistantReasoning += reasoningText;
              }
              if (chat?.tool_calls) {
                streamProgress.toolCallChunkCount += 1;
                partialToolCalls = chat.tool_calls;
              }
              if (chat?.tool_execution) {
                streamProgress.toolExecutionChunkCount += 1;
                partialToolExecution = chat.tool_execution;
              }
              if (chat?.tool_execution_delta) {
                streamProgress.toolExecutionChunkCount += 1;
                streamSegmentCollector.upsertToolExecution(chat.tool_execution_delta);
                partialToolExecution = streamSegmentCollector.serializeToolExecutions();
              }
              if (chat?.networkSearchResult) {
                partialNetworkSearchResult = chat.networkSearchResult;
              }
              if (chatPayload?.fileVectorResult) {
                partialFileVectorResult = chatPayload.fileVectorResult;
              }
              if (!streamProgress.firstProgressAt) {
                streamProgress.firstProgressAt = now;
                this.logTrace('debug', traceId, '收到首个流式片段', {
                  assistantLogId,
                  contentLength: contentText.length,
                  downstreamDelayMs: now - downstreamStartedAt,
                  hasReasoning: Boolean(reasoningText),
                  hasToolCalls: Boolean(chat?.tool_calls),
                  hasToolExecution: Boolean(chat?.tool_execution),
                });
              }
              streamProgress.lastProgressAt = now;

              if (
                shouldLogProgressHeartbeat(
                  streamProgress.progressEventCount,
                  streamProgress.lastProgressLogAt,
                  now,
                )
              ) {
                streamProgress.lastProgressLogAt = now;
                this.logTrace('debug', traceId, '流式响应心跳', {
                  assistantLogId,
                  durationMs: now - requestStartedAt,
                  streamProgress: this.getStreamProgressSnapshot(
                    streamProgress,
                    now,
                    requestStartedAt,
                  ),
                });
              }

              void persistPartialAssistantLog(false);
              res.write(`\n${JSON.stringify(chat)}`);
            },
            onFailure: async data => {
              this.logTrace('error', traceId, '下游聊天服务返回失败回调', {
                assistantLogId,
                data: serializeErrorForLog(data),
                durationMs: Date.now() - requestStartedAt,
              });
              partialAssistantContent = String(data?.full_content || partialAssistantContent || '');
              partialAssistantReasoning = String(
                data?.full_reasoning_content || partialAssistantReasoning || '',
              );
              partialToolCalls = data?.tool_calls || partialToolCalls;
              partialToolExecution = data?.tool_execution || partialToolExecution;
              partialNetworkSearchResult = data?.networkSearchResult || partialNetworkSearchResult;
              partialFileVectorResult = data?.fileVectorResult || partialFileVectorResult;
              appendInterruptedSegment(streamSegmentCollector);
              await persistPartialAssistantLog(true);
              await this.chatLogService.updateChatLog(assistantLogId, {
                ...buildAssistantFailureLogUpdate(data),
                stream_segments: streamSegmentCollector.serialize(),
              });
            },
            onDatabase: async data => {
              // 保存数据到数据库
              if (data.networkSearchResult) {
                await this.chatLogService.updateChatLog(assistantLogId, {
                  networkSearchResult: data.networkSearchResult,
                });
              }
              if (data.fileVectorResult) {
                await this.chatLogService.updateChatLog(assistantLogId, {
                  fileVectorResult: data.fileVectorResult,
                });
              }
            },
            abortController,
            traceId,
          });

          Logger.debug(
            `response summary: ${JSON.stringify({
              errMsg: response?.errMsg || null,
              finishReason: response?.finishReason || null,
              fullContentLength: response?.full_content?.length || 0,
              fullReasoningLength: response?.full_reasoning_content?.length || 0,
              hasToolCalls: Boolean(response?.tool_calls),
              hasToolExecution: Boolean(response?.tool_execution),
            })}`,
            'ChatService',
          );
          this.logTrace('debug', traceId, '下游聊天服务调用结束', {
            assistantLogId,
            downstreamDurationMs: Date.now() - downstreamStartedAt,
            errMsg: response?.errMsg || null,
            finishReason: response?.finishReason || null,
            fullContentLength: response?.full_content?.length || 0,
            fullReasoningLength: response?.full_reasoning_content?.length || 0,
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
          });

          if (shouldTreatAssistantResponseAsInterrupted(response)) {
            appendInterruptedSegment(streamSegmentCollector);
            await persistPartialAssistantLog(true);
            await partialPersistQueue;
            if (response.agentBilling) {
              await this.chatLogService.updateChatLog(assistantLogId, {
                completionTokens: response.agentBilling.completionTokens,
                promptTokens: response.agentBilling.promptTokens,
                totalTokens: response.agentBilling.totalTokens,
              });
              await this.chatLogService.updateChatLog(userLogId, {
                completionTokens: 0,
                promptTokens: response.agentBilling.promptTokens,
                totalTokens: response.agentBilling.promptTokens,
              });
            }
            await this.chatLogService.updateChatLog(assistantLogId, {
              ...buildAssistantFailureLogUpdate({
                ...response,
                full_content: partialAssistantContent || response.full_content,
                full_reasoning_content:
                  partialAssistantReasoning || response.full_reasoning_content,
              }),
              stream_segments: streamSegmentCollector.serialize(),
            });
            this.logTrace(
              response.errMsg ? 'error' : 'warn',
              traceId,
              response.agentBilling
                ? response.errMsg
                  ? '回复出错，Agent 内部模型调用已按实际用量结算'
                  : '回复因长度截断，Agent 内部模型调用已按实际用量结算'
                : response.errMsg
                  ? '回复出错，本次不扣除积分'
                  : '回复因长度截断，请点击“继续”接着操作',
              {
                assistantLogId,
                agentBilling: response.agentBilling || null,
                error: response.errMsg || null,
                finishReason: response?.finishReason || null,
                model: useModel,
                modelName: useModeName,
                userId: req.user.id,
              },
            );
            response.errMsg = INTERRUPTED_CHAT_MESSAGE;
            response.error = INTERRUPTED_CHAT_MESSAGE;
            response.content = [
              {
                type: 'text',
                text: INTERRUPTED_CHAT_MESSAGE,
              },
            ];
            return res.write(`\n${JSON.stringify(response)}`);
          }

          let totalText = '';
          messagesHistory.forEach(messagesHistory => {
            totalText += messagesHistory.content + ' ';
          });
          const promptTokens = await getTokenCount(totalText);
          const completionTokens = await getTokenCount(
            response.full_reasoning_content + response.full_content,
          );
          const agentBilling = response.agentBilling || null;
          const billingPromptTokens = agentBilling?.promptTokens ?? promptTokens;
          const billingCompletionTokens = agentBilling?.completionTokens ?? completionTokens;
          const billingTotalTokens =
            agentBilling?.totalTokens ?? billingPromptTokens + billingCompletionTokens;

          await this.chatLogService.updateChatLog(userLogId, {
            promptTokens: billingPromptTokens,
            completionTokens: 0,
            totalTokens: billingPromptTokens,
          });

          let sanitizedAnswer = response.full_content;
          if (isSensitiveWordFilter === '1') {
            const triggeredWords = await this.badWordsService.checkBadWords(
              response.full_content,
              req.user.id,
            );

            if (triggeredWords.length > 0) {
              // 构造一个正则表达式来匹配所有敏感词
              const regex = new RegExp(triggeredWords.join('|'), 'gi'); // 忽略大小写替换

              // 使用回调函数替换敏感词，每个敏感词替换为相应长度的 *
              sanitizedAnswer = sanitizedAnswer.replace(regex, matched =>
                '*'.repeat(matched.length),
              );
              Logger.debug(`检测到敏感词，已进行屏蔽处理`, 'ChatService');
            }
          }

          const artifactFiles = this.diffArtifactFiles(
            artifactSnapshotBefore,
            await this.safeListConversationArtifactFiles(req.user.id, groupId, traceId, 'after'),
          );
          const artifactFilesJson = artifactFiles.length ? JSON.stringify(artifactFiles) : '';
          if (artifactFiles.length) {
            this.logTrace('debug', traceId, '检测到本轮新增或更新的产物文件', {
              assistantLogId,
              artifactCount: artifactFiles.length,
              groupId,
              paths: artifactFiles.map(file => file.path).slice(0, 20),
            });
          }

          // 如果检测到敏感词，替换为 ***
          // gpt回答 - 使用替换后的内容存入数据库
          await partialPersistQueue;
          await this.chatLogService.updateChatLog(assistantLogId, {
            // imageUrl: response?.imageUrl,
            content: sanitizedAnswer, // 使用替换后的内容
            reasoning_content: response.full_reasoning_content,
            tool_calls: response.tool_calls,
            tool_execution: response.tool_execution,
            stream_segments: streamSegmentCollector.serialize(),
            artifact_files: artifactFilesJson,
            promptTokens: billingPromptTokens,
            completionTokens: billingCompletionTokens,
            totalTokens: billingTotalTokens,
            status: 3,
          });

          try {
            if (isGeneratePromptReference === '1') {
              promptReference = await this.openAIChatService.chatFree(
                `根据用户提问{${prompt}}以及AI的回答{${response.full_content}}，生成三个更进入一步的问题来向AI提问，用{}包裹每个问题，不需要分行，不需要其他任何内容，单个提问不超过30个字`,
              );
              await this.chatLogService.updateChatLog(assistantLogId, {
                promptReference: promptReference,
              });
              Logger.debug(`生成了相关问题推荐`, 'ChatService');
            }
          } catch (error) {
            Logger.debug(`生成相关问题推荐失败: ${error}`);
          }

          if (agentBilling) {
            charge = agentBilling.charge;
          } else if (isTokenBased === true) {
            charge =
              deduct *
              Math.ceil(billingTotalTokens / tokenFeeRatio) *
              (usingDeepThinking ? deductDeepThink : 1);
          }

          if (!agentBilling) {
            await this.userBalanceService.deductFromBalance(
              req.user.id,
              deductType,
              charge,
              billingTotalTokens,
            );
            /* 记录key的使用次数 和使用token */
            await this.modelsService.saveUseLog(keyId, billingTotalTokens);
          }

          Logger.log(
            `对话完成 - 用户: ${req.user.id}, 模型: ${useModeName}(${model}), Token: ${billingTotalTokens}, 积分: ${charge}`,
            'ChatService',
          );
          this.logTrace('log', traceId, '对话请求完成', {
            assistantLogId,
            agentBilling: agentBilling
              ? {
                  agentRunId: agentBilling.agentRunId,
                  callCount: agentBilling.callCount,
                  settled: agentBilling.settled,
                }
              : null,
            charge,
            completionTokens: billingCompletionTokens,
            durationMs: Date.now() - requestStartedAt,
            finishReason: response?.finishReason || null,
            promptTokens: billingPromptTokens,
            totalTokens: billingTotalTokens,
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
            userBalanceWillRefresh: true,
          });
          const userBalance = await this.userBalanceService.queryUserBalance(req.user.id);
          response.userBalance = userBalance;
          response.chatId = assistantLogId;
          response.promptReference = promptReference;
          response.artifact_files = artifactFilesJson;
          return res.write(`\n${JSON.stringify(response)}`);
        } catch (error) {
          // 在这里处理错误，例如打印错误消息到控制台或向用户发送错误响应
          Logger.error('处理请求出错:', error);
          this.logTrace('error', traceId, '处理请求出错', {
            abortReason,
            assistantLogId,
            durationMs: Date.now() - requestStartedAt,
            error: serializeErrorForLog(error),
            streamProgress: this.getStreamProgressSnapshot(
              streamProgress,
              Date.now(),
              requestStartedAt,
            ),
          });
          // 根据你的应用需求，你可能想要在这里设置response为一个错误消息或执行其他错误处理逻辑
          appendInterruptedSegment(streamSegmentCollector);
          await persistPartialAssistantLog(true);
          await this.chatLogService.updateChatLog(assistantLogId, {
            status: 5,
            content: partialAssistantContent || INTERRUPTED_CHAT_MESSAGE,
            reasoning_content: partialAssistantReasoning || undefined,
            stream_segments: streamSegmentCollector.serialize(),
          });
          response = { error: INTERRUPTED_CHAT_MESSAGE };
        }
      }
    } catch (error) {
      Logger.error('聊天处理全局错误', error);
      this.logTrace('error', traceId, '聊天处理全局错误', {
        abortReason,
        assistantLogId,
        durationMs: Date.now() - requestStartedAt,
        error: serializeErrorForLog(error),
        streamProgress: this.getStreamProgressSnapshot(
          streamProgress,
          Date.now(),
          requestStartedAt,
        ),
      });
      if (res) {
        return res.write(INTERRUPTED_CHAT_MESSAGE);
      } else {
        throw new HttpException(INTERRUPTED_CHAT_MESSAGE, HttpStatus.BAD_REQUEST);
      }
    } finally {
      stopStreamKeepalive();
      this.unregisterActiveChatAbort(sessionId, activeAbortEntry);
      if (res) {
        this.logTrace('debug', traceId, '准备结束响应', {
          abortReason,
          assistantLogId,
          durationMs: Date.now() - requestStartedAt,
          headersSent: res.headersSent,
          streamProgress: this.getStreamProgressSnapshot(
            streamProgress,
            Date.now(),
            requestStartedAt,
          ),
          writableEnded: res.writableEnded,
        });

        if (!res.writableEnded) {
          res.end();
        }
      }
    }
  }

  async updateChatTitle(groupId, groupInfo, modelType, prompt, req) {
    if (groupInfo?.title === '新对话') {
      // '新对话' can be replaced with 'New chat' if needed
      let chatTitle: string;
      if (modelType === 1) {
        try {
          chatTitle = await this.openAIChatService.chatFree(
            `根据用户提问{${prompt}}，给这个对话取一个名字，不超过10个字，只需要返回标题，不需要其他任何内容。`,
          );
          if (chatTitle.length > 15) {
            chatTitle = chatTitle.slice(0, 15);
          }
          Logger.debug(`已生成对话标题: ${chatTitle}`);
        } catch (error) {
          Logger.debug(`标题生成失败，使用提问片段作为标题`);
          chatTitle = prompt.slice(0, 10);
        }
      } else {
        chatTitle = '创意 AI';
      }

      this.chatGroupService
        .update(
          {
            groupId,
            title: chatTitle,
          },
          req,
        )
        .then(() => Logger.debug(`更新对话标题: ${chatTitle}`))
        .catch(error => Logger.error(`更新对话标题失败`, error));
    }
  }

  async buildMessageFromParentMessageId(options: any, chatLogService) {
    const startTime = Date.now();

    let {
      systemMessage = '',
      maxRounds = 12,
      maxModelTokens = 64000,
      isFileUpload = 0,
      isImageUpload = 0,
      isConvertToBase64,
      groupId,
      onContextCompressionProgress,
      summaryModelConfig,
    } = options;

    // 确保 systemMessage 不超过 maxModelTokens
    // if (systemMessage.length > maxModelTokens) {
    //   Logger.debug(
    //     `系统消息过长(${systemMessage.length} > ${maxModelTokens})，进行截断处理`,
    //     'ChatService',
    //   );
    //   systemMessage = systemMessage.slice(0, maxModelTokens);
    // }

    const messages = [];
    let history = [];
    let conversationSummary = '';
    let summaryAwareHistory = false;

    const parsePersistedArray = (raw: any) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const buildToolResultContent = (execution: any) => {
      const preview = String(
        execution?.result_preview || execution?.display_subtitle || execution?.args_preview || '',
      ).trim();

      if (preview) {
        return preview;
      }

      if (execution?.is_error) {
        return `Tool ${execution?.tool_name || 'unknown'} failed.`;
      }

      if (execution?.phase === 'completed') {
        return `Tool ${execution?.tool_name || 'unknown'} completed.`;
      }

      return '';
    };

    const buildToolResultMessages = (
      toolCalls: any[],
      toolExecutions: any[],
      createdAt: Date | string,
    ) => {
      const executionById = new Map(
        toolExecutions
          .filter(item => item && typeof item === 'object' && item.tool_call_id)
          .map(item => [String(item.tool_call_id), item]),
      );
      const toolMessages = [];

      for (const toolCall of toolCalls) {
        const toolCallId = String(toolCall?.id || '').trim();
        if (!toolCallId) continue;
        const execution = executionById.get(toolCallId);
        if (!execution) continue;
        const content = buildToolResultContent(execution);
        if (!content) continue;
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content,
          createdAt,
        });
      }

      return toolMessages;
    };

    const buildMessagesFromHistory = async (records, memorySummary = '') => {
      const builtMessages = [];
      const memoryBlock = buildConversationMemoryBlock(memorySummary);
      const systemContent = [systemMessage, memoryBlock].filter(Boolean).join('\n\n');

      if (systemContent) {
        builtMessages.push({ role: 'system', content: systemContent });
      }

      const sortedRecords = [...records].sort(
        (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      );

      for (const record of sortedRecords) {
        try {
          let content = record.content || '';
          const persistedToolCalls = parsePersistedArray(record.tool_calls).filter(
            item =>
              item &&
              typeof item === 'object' &&
              item.function &&
              typeof item.id === 'string' &&
              item.id.trim(),
          );
          const persistedToolExecutions = parsePersistedArray(record.tool_execution).filter(
            item => item && typeof item === 'object' && item.tool_call_id,
          );

          if (isFileUpload === 1 && record.fileUrl) {
            try {
              const filesInfo = JSON.parse(record.fileUrl);
              if (Array.isArray(filesInfo)) {
                const fileUrls = filesInfo.map(file => file.url).join('\n');
                content = fileUrls + '\n' + content;
              } else {
                content = record.fileUrl + '\n' + content;
              }
            } catch (error) {
              content = record.fileUrl + '\n' + content;
              Logger.debug(`解析fileUrl失败，使用原始格式: ${error.message}`, 'ChatService');
            }
          }

          if (isImageUpload === 2 && record.imageUrl) {
            const imageContent = await Promise.all(
              record.imageUrl.split(',').map(async url => ({
                type: 'image_url',
                image_url: {
                  url:
                    isConvertToBase64 === '1' ? await convertUrlToBase64(url.trim()) : url.trim(),
                },
              })),
            );
            content = [{ type: 'text', text: content }, ...imageContent];
          } else if (isImageUpload === 1 && record.imageUrl) {
            content = record.imageUrl + '\n' + content;
          }

          if (record.role === 'assistant') {
            content = removeThinkTags(content);
            if (typeof content === 'string' && !content.trim() && persistedToolCalls.length === 0) {
              continue;
            }
            if (
              [4, 5].includes(Number(record.status)) &&
              typeof content === 'string' &&
              looksLikeTransientAssistantFailure(content)
            ) {
              continue;
            }

            const assistantMessage: Record<string, any> = {
              id: record.id,
              role: 'assistant',
              content,
              createdAt: record.createdAt,
            };
            if (persistedToolCalls.length > 0) {
              assistantMessage.tool_calls = persistedToolCalls;
            }

            builtMessages.push(assistantMessage);
            builtMessages.push(
              ...buildToolResultMessages(
                persistedToolCalls,
                persistedToolExecutions,
                record.createdAt,
              ),
            );
          } else if (record.role === 'user') {
            if (typeof content === 'string' && !content.trim()) {
              continue;
            }

            builtMessages.push({
              id: record.id,
              role: 'user',
              content,
              createdAt: record.createdAt,
            });
          }
        } catch (error) {
          Logger.debug(`处理历史记录ID=${record.id}失败: ${error.message}`, 'ChatService');
        }
      }

      return builtMessages;
    };

    if (groupId) {
      try {
        if (
          typeof chatLogService.findLatestConversationSummary === 'function' &&
          typeof chatLogService.findConversationContextLogs === 'function'
        ) {
          const latestSummary = await chatLogService.findLatestConversationSummary(groupId);
          const summaryMetadata = parseConversationSummaryMetadata(latestSummary?.metadata);
          conversationSummary = latestSummary?.content || '';
          history = await chatLogService.findConversationContextLogs(
            groupId,
            summaryMetadata?.coveredChatLogId || 0,
          );
          summaryAwareHistory = true;
        } else {
          history = await chatLogService.chatHistory(groupId, maxRounds);
        }

        messages.push(...(await buildMessagesFromHistory(history, conversationSummary)));
      } catch (error) {
        Logger.error(`获取聊天历史记录失败: ${error.message}`, 'ChatService');
      }
    }

    // 计算并限制token数量
    let totalTokens = await getTokenCount(messages);

    // 动态计算token限制
    const tokenLimit = maxModelTokens < 8000 ? 4000 : maxModelTokens - 4000;

    // 如果超出token限制，进行裁剪
    if (totalTokens > tokenLimit && summaryAwareHistory && history.length > 0) {
      const summaryCandidates = history.filter(record => {
        if (record.role === 'user') return Boolean(record.content);
        if (record.role === 'assistant') return Boolean(String(record.content || '').trim());
        return false;
      });
      const keepRecentMessageCount = Math.min(Math.max(Number(maxRounds) || 6, 6), 12);
      const { messagesToSummarize, recentMessages, coveredChatLogId } = selectMessagesForSummary(
        summaryCandidates,
        keepRecentMessageCount,
      );

      if (
        messagesToSummarize.length > 0 &&
        coveredChatLogId &&
        typeof chatLogService.saveConversationSummary === 'function'
      ) {
        try {
          onContextCompressionProgress?.({
            event: 'start',
            phase: 'executing',
            title: '正在自动压缩上下文',
            message: '历史对话较长，OpenWork 正在压缩旧上下文以保持对话连续。',
            progress: 5,
          });
          const taskStateSnapshot = buildConversationTaskStateSnapshot([
            ...messagesToSummarize,
            ...recentMessages,
          ]);
          const summarySystemMessage =
            '你是 OpenWork 的会话记忆压缩器。你的任务是把历史对话压缩为后续模型可用的任务摘要，优先保留用户目标、已确认决策、当前工作流状态、关键产物、未完成事项和恢复提示。不要复述系统提示词或整段技能文件原文。';
          const summaryChunks = chunkMessagesForSummary(messagesToSummarize);
          let nextSummary = conversationSummary;

          for (const [chunkIndex, chunk] of summaryChunks.entries()) {
            onContextCompressionProgress?.({
              event: 'update',
              phase: 'executing',
              title: '正在自动压缩上下文',
              message: `正在压缩第 ${chunkIndex + 1}/${summaryChunks.length} 段历史信息。`,
              progress: Math.min(90, Math.round(((chunkIndex + 1) / summaryChunks.length) * 80)),
            });
            const previousSummary = nextSummary ? `已有会话摘要：\n${nextSummary}\n\n` : '';
            const summaryPrompt = [
              previousSummary,
              '请将以下对话压缩为一份新的连续会话摘要。',
              '摘要必须优先保留：用户目标、偏好、限制、已确认方案、当前任务状态、当前工作流步骤、关键产物路径、未完成事项、恢复提示。',
              taskStateSnapshot ? `当前任务状态快照：\n${taskStateSnapshot}\n` : '',
              '只输出摘要正文，不要解释压缩过程。',
              '',
              formatMessagesForSummary(chunk),
            ].join('\n');
            const chunkSummary = await this.openAIChatService.chatFree(
              summaryPrompt,
              summarySystemMessage,
              undefined,
              undefined,
              summaryModelConfig,
            );

            if (!chunkSummary) {
              throw new Error('会话摘要模型未返回内容');
            }

            nextSummary = chunkSummary;
          }

          if (nextSummary) {
            const summaryUserId =
              messagesToSummarize.find(record => record.userId)?.userId ||
              recentMessages.find(record => record.userId)?.userId;

            if (!summaryUserId) {
              throw new Error('缺少会话摘要所属用户ID');
            }

            await chatLogService.saveConversationSummary({
              content: nextSummary,
              coveredChatLogId,
              groupId,
              sourceMessageCount: messagesToSummarize.length,
              userId: summaryUserId,
            });
            onContextCompressionProgress?.({
              event: 'end',
              phase: 'completed',
              title: '上下文压缩完成',
              message: '已压缩旧历史，并保留最近对话原文继续执行。',
              progress: 100,
              resultPreview: `已压缩 ${messagesToSummarize.length} 条历史消息。`,
            });

            conversationSummary = nextSummary;
            messages.length = 0;
            messages.push(...(await buildMessagesFromHistory(recentMessages, conversationSummary)));
            totalTokens = await getTokenCount(messages);

            Logger.debug(
              `已生成内部会话摘要并重建上下文: summarized=${messagesToSummarize.length}, recent=${recentMessages.length}, tokens=${totalTokens}`,
              'ChatService',
            );
          }
        } catch (error) {
          onContextCompressionProgress?.({
            event: 'end',
            phase: 'completed',
            title: '上下文压缩失败',
            message: '自动压缩没有完成，将回退到常规上下文裁剪。',
            progress: 100,
            isError: true,
            resultPreview: error.message,
          });
          Logger.warn(`生成内部会话摘要失败，回退到原有裁剪逻辑: ${error.message}`, 'ChatService');
        }
      }
    }

    if (totalTokens > tokenLimit) {
      Logger.debug(`消息超出token限制(${totalTokens} > ${tokenLimit})，开始裁剪`, 'ChatService');

      // 优化的裁剪算法
      let trimIteration = 0;
      while (totalTokens > tokenLimit && messages.length > 2) {
        trimIteration++;

        // 检查是否只剩下系统消息和当前用户消息
        if (
          messages.length === 2 &&
          ((messages[0].role === 'system' && messages[1].role === 'user') ||
            (messages[0].role === 'user' && messages[1].role === 'user'))
        ) {
          break;
        }

        // 保留系统消息和最后一条用户消息
        const systemIndex = messages.findIndex(m => m.role === 'system');
        const lastUserIndex = messages.length - 1; // 最后一条始终是当前用户消息

        // 从前往后删除非系统消息，直到剩下系统消息和最新用户消息
        // 优先删除较早的消息对
        if (messages.length > 2) {
          // 跳过系统消息
          const startIndex = systemIndex === 0 ? 1 : 0;

          // 删除最早的user-assistant对或单条消息
          if (startIndex < lastUserIndex) {
            if (
              messages[startIndex].role === 'user' &&
              startIndex + 1 < lastUserIndex &&
              messages[startIndex + 1].role === 'assistant'
            ) {
              // 删除一对消息
              messages.splice(startIndex, 2);
            } else {
              // 删除单条消息
              messages.splice(startIndex, 1);
            }
          }
        }

        // 重新计算token
        const newTotalTokens = await getTokenCount(messages);
        if (newTotalTokens >= totalTokens) {
          // 如果token没有减少，说明无法继续优化，强制退出
          Logger.debug('Token裁剪无效，停止裁剪过程');
          break;
        }

        // 更新token计数
        totalTokens = newTotalTokens;
      }
    }

    if (messages.length > 1) {
      const systemMessages = messages.filter(message => message.role === 'system');
      const conversationMessages = messages
        .filter(message => message.role !== 'system')
        .sort(
          (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
        );
      messages.length = 0;
      messages.push(...systemMessages, ...conversationMessages);
    }

    const messagesHistory = messages.map(message => {
      const payload: Record<string, any> = {
        role: message.role,
        content: message.content,
      };

      if (message.tool_calls) {
        payload.tool_calls = message.tool_calls;
      }

      if (message.tool_call_id) {
        payload.tool_call_id = message.tool_call_id;
      }

      return payload;
    });
    totalTokens = await getTokenCount(messagesHistory);

    Logger.debug(
      `构建消息历史完成: ${Math.floor(
        messagesHistory.length / 2,
      )} 组对话, ${totalTokens} tokens, 耗时: ${Date.now() - startTime}ms`,
      'ChatService',
    );

    Logger.debug(
      `messages summary: ${JSON.stringify({
        messageCount: messagesHistory.length,
        roles: messagesHistory.map(message => message.role),
        totalTokens,
      })}`,
      'ChatService',
    );

    // throw new Error('test');
    return {
      messagesHistory,
      round: messagesHistory.length,
    };
  }

  async ttsProcess(body: any, req: any, res?: any) {
    const { chatId, prompt } = body;

    const detailKeyInfo = await this.modelsService.getCurrentModelKeyInfo('tts-1');
    const { openaiBaseUrl, openaiBaseKey, openaiVoice } = await this.globalConfigService.getConfigs(
      ['openaiBaseUrl', 'openaiBaseKey', 'openaiVoice'],
    );

    // 从 detailKeyInfo 对象中解构赋值并设置默认值
    const { key, proxyUrl, deduct, deductType, timeout } = detailKeyInfo;
    const useKey = key || openaiBaseKey;
    const useTimeout = timeout * 1000;

    // 用户余额检测
    await this.userBalanceService.validateBalance(req, deductType, deduct);

    Logger.debug(
      `开始TTS处理: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`,
      'TTSService',
    );

    try {
      // 使用OpenAI SDK进行TTS请求
      const formattedUrl = formatUrl(proxyUrl || openaiBaseUrl);
      const correctedProxyUrl = await correctApiBaseUrl(formattedUrl);
      const openai = new OpenAI({
        apiKey: useKey,
        baseURL: correctedProxyUrl,
        timeout: useTimeout,
      });

      // 获取音频数据
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        input: prompt,
        voice: openaiVoice || 'onyx',
      });

      // 将响应转换为buffer
      const buffer = Buffer.from(await response.arrayBuffer());
      Logger.debug('TTS音频数据生成成功', 'TTSService');

      // 使用 Date 对象获取当前日期并格式化为 YYYYMM/DD
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从0开始，所以+1
      const day = String(now.getDate()).padStart(2, '0');
      const currentDate = `${year}${month}/${day}`;

      const ttsUrl = await this.uploadService.uploadFile(
        { buffer, mimetype: 'audio/mpeg' },
        `audio/openai/${currentDate}`,
      );

      // 更新聊天记录并扣除余额
      await Promise.all([
        this.chatLogService.updateChatLog(chatId, { ttsUrl }),
        this.userBalanceService.deductFromBalance(req.user.id, deductType, deduct),
      ]);

      res.status(200).send({ ttsUrl });
    } catch (error) {
      Logger.error('TTS处理失败', error, 'TTSService');
      res.status(500).send({ error: '语音合成请求处理失败' });
    }
  }
}
