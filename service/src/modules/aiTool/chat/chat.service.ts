import { handleError } from '@/common/utils';
import { serializeErrorForLog, shouldLogProgressHeartbeat } from '@/common/utils/chatTrace';
import { correctApiBaseUrl } from '@/common/utils/correctApiBaseUrl';
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { GlobalConfigService } from '../../globalConfig/globalConfig.service';
import { NetSearchService } from '../search/netSearch.service';
import { PiRuntimeManagerService, resolveConversationWorkspace } from './piRuntimeManager';
import {
  buildToolExecutionProgressDelta,
  mergeToolCallState,
  mergeToolExecutionState,
  serializeToolCallStates,
  serializeToolExecutionStates,
  ToolCallState,
  ToolExecutionState,
} from './piToolStream';
import { normalizeArtifactReadPath } from './artifactPath';
import { resolveRequestedWebSearchEnabled, resolveRequestedWebSearchLimit } from './webSearchMode';
import { resolveDiscussionModel } from './discussionModel';
import { AgentRunSettlement } from './agentModelProxy';
import { AgentModelProxyService } from './agentModelProxy.service';

interface PiGatewayChunkChoiceDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  network_search_result?: string;
  tool_execution?: {
    event?: 'start' | 'update' | 'end';
    phase?: 'assembling' | 'executing' | 'completed';
    tool_name?: string;
    tool_call_id?: string;
    kind?: 'tool' | 'workflow_step';
    step?: string;
    step_title?: string;
    display_title?: string;
    display_subtitle?: string;
    target?: string;
    progress?: number;
    args_complete?: boolean;
    args_preview?: string;
    is_error?: boolean;
    result_preview?: string;
  };
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface PiGatewayChunk {
  choices?: Array<{
    delta?: PiGatewayChunkChoiceDelta;
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

type StreamHeartbeatStats = {
  chunkCount: number;
  eventCount: number;
  contentChars: number;
  reasoningChars: number;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  lastLogAt: number;
};
// 引入其他需要的模块或服务

@Injectable()
export class OpenAIChatService {
  private readonly piGatewayUrl =
    process.env.PI_GATEWAY_CHAT_URL || 'http://127.0.0.1:8787/v1/chat/completions';

  constructor(
    private readonly globalConfigService: GlobalConfigService,
    private readonly netSearchService: NetSearchService,
    private readonly piRuntimeManagerService: PiRuntimeManagerService,
    private readonly agentModelProxyService: AgentModelProxyService,
  ) {}

  private logTrace(
    level: 'debug' | 'warn' | 'error' | 'log',
    traceId: string | undefined,
    message: string,
    context?: Record<string, any>,
  ) {
    const prefix = traceId ? `[traceId=${traceId}] ` : '';
    const suffix = context ? ` | ${JSON.stringify(context)}` : '';
    const content = `${prefix}${message}${suffix}`;

    if (level === 'error') {
      Logger.error(content, undefined, 'OpenAIChatService');
      return;
    }

    if (level === 'warn') {
      Logger.warn(content, 'OpenAIChatService');
      return;
    }

    if (level === 'log') {
      Logger.log(content, 'OpenAIChatService');
      return;
    }

    Logger.debug(content, 'OpenAIChatService');
  }

  private getHeartbeatSnapshot(stats: StreamHeartbeatStats, now: number, startedAt: number) {
    return {
      chunkCount: stats.chunkCount,
      eventCount: stats.eventCount,
      contentChars: stats.contentChars,
      reasoningChars: stats.reasoningChars,
      firstChunkDelayMs: stats.firstChunkAt ? stats.firstChunkAt - startedAt : null,
      lastChunkAgoMs: stats.lastChunkAt ? now - stats.lastChunkAt : null,
    };
  }

  private getPiGatewayAbortUrl() {
    if (process.env.PI_GATEWAY_ABORT_URL) {
      return process.env.PI_GATEWAY_ABORT_URL;
    }

    return this.piGatewayUrl.replace(/\/v1\/chat\/completions\/?$/, '/v1/chat/sessions/abort');
  }

  private getDefaultPiGatewayBaseUrl() {
    return this.piGatewayUrl.replace(/\/v1\/chat\/completions\/?$/, '');
  }

  private buildPiGatewayUrl(baseUrl: string, pathname: string) {
    return `${baseUrl.replace(/\/+$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }

  private async resolvePiGatewayBaseUrl(input: {
    groupId?: number | string;
    traceId?: string;
    userId?: number;
  }) {
    if (this.piRuntimeManagerService.isDockerEnabled()) {
      if (!input.userId) {
        throw new Error('缺少用户 ID，无法定位专属 PI runtime');
      }
      if (!input.groupId) {
        throw new Error('缺少对话分组 ID，无法定位专属 PI runtime');
      }
      const runtime = await this.piRuntimeManagerService.ensureRuntime(
        {
          groupId: input.groupId,
          userId: input.userId,
        },
        input.traceId,
      );
      return runtime.baseUrl;
    }

    return this.piRuntimeManagerService.getDirectGatewayBaseUrl();
  }

  async requestPiDiscussion<T = any>(input: {
    action: 'discover_experts' | 'create_room' | 'continue_round' | 'send_message' | 'stop';
    payload?: Record<string, any>;
    roomId?: string;
    sessionId?: string;
    groupId?: string | number;
    userId?: number;
    traceId?: string;
    workspaceDir?: string;
  }): Promise<T> {
    const openaiBaseModel = await this.globalConfigService.getConfigs(['openaiBaseModel']);
    const model = resolveDiscussionModel(openaiBaseModel);
    const sessionId = input.sessionId || `discussion-${input.roomId || input.groupId || 'default'}`;
    const runtimeGroupId = input.groupId || input.roomId || sessionId;
    const workspaceDir =
      input.workspaceDir ||
      (input.groupId
        ? resolveConversationWorkspace(Number(input.groupId))
        : `conversations/${sessionId}`);
    const piGatewayUrl = this.buildPiGatewayUrl(
      await this.resolvePiGatewayBaseUrl({
        groupId: runtimeGroupId,
        traceId: input.traceId,
        userId: input.userId,
      }),
      '/v1/chat/completions',
    );

    this.logTrace('log', input.traceId, '开始请求 PI discussion runtime', {
      action: input.action,
      model,
      roomId: input.roomId || input.payload?.roomId || null,
      sessionId,
      url: piGatewayUrl,
      workspaceDir,
    });

    let agentRunId: string | undefined;
    let modelProxy:
      | {
          apiKey: string;
          baseUrl: string;
          model: string;
        }
      | undefined;

    if (input.userId) {
      const agentRun = await this.agentModelProxyService.createRun({
        groupId: typeof input.groupId === 'number' ? input.groupId : undefined,
        model,
        proxyBaseUrl: this.piRuntimeManagerService.resolveInternalModelProxyBaseUrl(),
        traceId: input.traceId,
        userId: input.userId,
      });
      agentRunId = agentRun.agentRunId;
      modelProxy = agentRun.modelProxy;
    }

    const webSearchProfile = await this.netSearchService.getWebSearchCapabilityProfile('chat');

    try {
      const response = await fetch(piGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: `OpenWork discussion action: ${input.action}`,
            },
          ],
          stream: false,
          session_id: sessionId,
          conversation_id: sessionId,
          group_id: input.groupId,
          workspace_dir: workspaceDir,
          discussion_action: input.action,
          discussion_room_id: input.roomId,
          discussion_payload: input.payload || {},
          web_search_enabled: true,
          web_search_limit: 20,
          web_search_profile: webSearchProfile,
          model_proxy: modelProxy,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`PI discussion request failed: ${response.status} ${JSON.stringify(data)}`);
      }

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('PI discussion response is empty');
      }

      try {
        return JSON.parse(content) as T;
      } catch (error) {
        throw new Error(`PI discussion response is not valid JSON: ${content.slice(0, 300)}`);
      }
    } finally {
      if (agentRunId) {
        await this.agentModelProxyService.settleRun(agentRunId).catch(error => {
          this.logTrace('warn', input.traceId, 'PI discussion agent 结算失败', {
            agentRunId,
            error: serializeErrorForLog(error),
          });
        });
      }
    }
  }

  async abortPiSession(
    sessionId: string,
    userId?: number,
    groupId?: number | string,
    traceId?: string,
  ) {
    const runtimeGroupId = groupId || sessionId;
    if (this.piRuntimeManagerService.isDockerEnabled()) {
      const runtime = userId
        ? await this.piRuntimeManagerService.findRuntime(
            { groupId: runtimeGroupId, userId },
            false,
            traceId,
          )
        : null;
      if (!runtime) {
        return {
          durationMs: 0,
          ok: false,
          reason: 'runtime_not_found',
          sessionId,
          skipped: true,
        };
      }
    }

    const baseUrl = await this.resolvePiGatewayBaseUrl({
      groupId: runtimeGroupId,
      traceId,
      userId,
    });
    const abortUrl = this.piRuntimeManagerService.isDockerEnabled()
      ? this.buildPiGatewayUrl(baseUrl, '/v1/chat/sessions/abort')
      : this.getPiGatewayAbortUrl();
    const startedAt = Date.now();

    try {
      this.logTrace('log', traceId, '开始请求 PI gateway 中断会话', {
        sessionId,
        url: abortUrl,
      });

      const response = await fetch(abortUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
        }),
      });

      const data = await response.json().catch(() => null);
      const summary = {
        durationMs: Date.now() - startedAt,
        ok: response.ok,
        sessionId,
        status: response.status,
        statusText: response.statusText,
        ...(data && typeof data === 'object' ? (data as Record<string, any>) : {}),
      };

      if (!response.ok) {
        this.logTrace('warn', traceId, 'PI gateway 中断会话请求返回异常状态', summary);
      } else {
        this.logTrace('log', traceId, 'PI gateway 中断会话完成', summary);
      }

      return summary;
    } catch (error) {
      const summary = {
        durationMs: Date.now() - startedAt,
        error: serializeErrorForLog(error),
        ok: false,
        sessionId,
        url: abortUrl,
      };
      this.logTrace('warn', traceId, 'PI gateway 中断会话请求失败', summary);
      return summary;
    }
  }

  async listArtifacts(userId: number, groupId: number, traceId?: string) {
    const baseUrl = await this.resolvePiGatewayBaseUrl({ groupId, traceId, userId });
    const url = this.buildPiGatewayUrl(baseUrl, '/v1/artifacts/list');
    const workspaceDir = resolveConversationWorkspace(groupId);

    this.logTrace('debug', traceId, '开始请求 PI artifacts list', {
      groupId,
      url,
      userId,
      workspaceDir,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        group_id: groupId,
        workspace_dir: workspaceDir,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`PI artifacts list failed: ${response.status} ${JSON.stringify(data)}`);
    }

    return data;
  }

  async getRuntimeStatus(userId: number, groupId: number, traceId?: string) {
    const runtime = await this.piRuntimeManagerService.findRuntime(
      { groupId, userId },
      false,
      traceId,
    );

    if (!runtime) {
      return {
        groupId,
        mode: this.piRuntimeManagerService.isDockerEnabled() ? 'docker' : 'direct',
        running: false,
        userId,
      };
    }

    return runtime;
  }

  async readArtifact(
    userId: number,
    groupId: number,
    runId: string | undefined,
    artifactPath: string,
    traceId?: string,
  ) {
    const baseUrl = await this.resolvePiGatewayBaseUrl({ groupId, traceId, userId });
    const url = this.buildPiGatewayUrl(baseUrl, '/v1/artifacts/read');
    const workspaceDir = resolveConversationWorkspace(groupId);
    const normalizedArtifactPath = normalizeArtifactReadPath(artifactPath, runId);

    this.logTrace('debug', traceId, '开始请求 PI artifact read', {
      artifactPath,
      groupId,
      normalizedArtifactPath,
      runId: runId || null,
      url,
      userId,
      workspaceDir,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        group_id: groupId,
        path: normalizedArtifactPath,
        ...(runId ? { run_id: runId } : {}),
        workspace_dir: workspaceDir,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`PI artifacts read failed: ${response.status} ${JSON.stringify(data)}`);
    }

    return data;
  }

  async rewriteArtifact(
    userId: number,
    groupId: number,
    runId: string | undefined,
    artifactPath: string,
    content: string,
    traceId?: string,
  ) {
    const baseUrl = await this.resolvePiGatewayBaseUrl({ groupId, traceId, userId });
    const url = this.buildPiGatewayUrl(baseUrl, '/v1/artifacts/rewrite');
    const workspaceDir = resolveConversationWorkspace(groupId);
    const normalizedArtifactPath = normalizeArtifactReadPath(artifactPath, runId);

    this.logTrace('debug', traceId, '开始请求 PI artifact rewrite', {
      artifactPath,
      contentSize: content.length,
      groupId,
      normalizedArtifactPath,
      runId: runId || null,
      url,
      userId,
      workspaceDir,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        group_id: groupId,
        path: normalizedArtifactPath,
        ...(runId ? { run_id: runId } : {}),
        workspace_dir: workspaceDir,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`PI artifacts rewrite failed: ${response.status} ${JSON.stringify(data)}`);
    }

    return data;
  }

  /**
   * 处理深度思考逻辑
   * @param messagesHistory 消息历史
   * @param inputs 输入参数
   * @param result 结果对象
   * @returns 是否应该终止请求
   */
  private async handleDeepThinking(
    messagesHistory: any,
    inputs: {
      apiKey: any;
      model: any;
      proxyUrl: any;
      timeout: any;
      usingDeepThinking?: boolean;
      deepThinkingModel?: string;
      deepThinkingUrl?: string;
      deepThinkingKey?: string;
      searchResults?: any[];
      deepThinkingType?: any;
      abortController: AbortController;
      traceId?: string;
      onProgress?: (data: any) => void;
    },
    result: any,
  ): Promise<boolean> {
    const {
      apiKey,
      model,
      proxyUrl,
      timeout,
      usingDeepThinking,
      searchResults,
      abortController,
      deepThinkingType,
      traceId,
      onProgress,
    } = inputs;

    const {
      openaiBaseUrl,
      openaiBaseKey,
      openaiBaseModel,
      deepThinkingUrl,
      deepThinkingKey,
      deepThinkingModel,
    } = await this.globalConfigService.getConfigs([
      'openaiBaseUrl',
      'openaiBaseKey',
      'openaiBaseModel',
      'deepThinkingUrl',
      'deepThinkingKey',
      'deepThinkingModel',
    ]);

    // 如果不使用深度思考且不是DeepSeek模型，直接返回
    if (!usingDeepThinking && deepThinkingType !== 2) {
      return false;
    }

    const deepUrl = deepThinkingType === 2 ? proxyUrl : deepThinkingUrl || openaiBaseUrl;
    const deepKey = deepThinkingType === 2 ? apiKey : deepThinkingKey || openaiBaseKey;
    const deepModel = deepThinkingType === 2 ? model : deepThinkingModel || openaiBaseModel;

    let shouldEndThinkStream = false;
    let thinkingSourceType = null; // 'reasoning_content' 或 'think_tag'

    // 处理所有消息中的imageUrl类型
    const processedMessages = JSON.parse(JSON.stringify(messagesHistory)).map((message: any) => {
      if (message.role === 'user' && Array.isArray(message.content)) {
        // 将带有image_url类型的内容转换为普通文本
        message.content = message.content
          .filter((item: any) => item.type !== 'image_url')
          .map((item: any) => item.text || item)
          .join('');
      }
      return message;
    });

    // 添加文件向量搜索、图片描述和MCP工具结果到system消息
    const systemMessageIndex = processedMessages.findIndex((msg: any) => msg.role === 'system');
    let additionalContent = '';

    // 如果有网络搜索结果，添加到system消息中
    if (searchResults && searchResults.length > 0) {
      // 将 searchResult 转换为 JSON 字符串
      let searchPrompt = JSON.stringify(searchResults, null, 2);

      additionalContent += `\n\n以下是网络搜索结果（请基于这些信息回答用户问题，这些信息比你的训练数据更新）：\n${searchPrompt}`;
    }

    // 将额外内容添加到system消息中
    if (systemMessageIndex !== -1) {
      processedMessages[systemMessageIndex].content += additionalContent;
    } else if (additionalContent) {
      processedMessages.unshift({
        role: 'system',
        content: additionalContent,
      });
    }

    const correctedDeepUrl = await correctApiBaseUrl(deepUrl);
    const thinkOpenai = new OpenAI({
      apiKey: deepKey,
      baseURL: correctedDeepUrl,
      timeout: timeout * 5,
    });

    const thinkStartedAt = Date.now();
    const thinkStats: StreamHeartbeatStats = {
      chunkCount: 0,
      eventCount: 0,
      contentChars: 0,
      reasoningChars: 0,
      firstChunkAt: null,
      lastChunkAt: null,
      lastLogAt: thinkStartedAt,
    };

    Logger.debug(
      `思考流请求 - model: ${deepModel}, messageCount: ${processedMessages.length}`,
      'OpenAIChatService',
    );
    this.logTrace('debug', traceId, '开始深度思考流请求', {
      deepModel,
      deepThinkingType,
      messageCount: processedMessages.length,
      timeoutMs: timeout * 5,
      url: correctedDeepUrl,
    });

    // 构建请求配置
    const requestConfig: any = {
      model: deepModel,
      messages: processedMessages,
      stream: true,
    };

    // 如果是 grok-3-mini-latest 模型，添加 reasoning_effort 参数
    // if (deepModel === 'grok-3-mini-latest') {
    //   requestConfig.reasoning_effort = 'high';
    //   Logger.debug('为grok-3-mini-latest模型添加reasoning_effort=high参数', 'OpenAIChatService');
    // }

    const stream = await thinkOpenai.chat.completions.create(requestConfig, {
      signal: abortController.signal,
    });

    // @ts-ignore - 忽略TypeScript错误，因为我们知道stream是可迭代的
    for await (const chunk of stream) {
      if (abortController.signal.aborted || shouldEndThinkStream) {
        this.logTrace('warn', traceId, '深度思考流提前终止', {
          aborted: abortController.signal.aborted,
          durationMs: Date.now() - thinkStartedAt,
          shouldEndThinkStream,
          stream: this.getHeartbeatSnapshot(thinkStats, Date.now(), thinkStartedAt),
        });
        break;
      }
      const now = Date.now();
      thinkStats.chunkCount += 1;
      thinkStats.eventCount += 1;
      if (!thinkStats.firstChunkAt) {
        thinkStats.firstChunkAt = now;
        this.logTrace('debug', traceId, '收到深度思考首个片段', {
          delayMs: now - thinkStartedAt,
        });
      }
      thinkStats.lastChunkAt = now;
      const delta = chunk.choices[0]?.delta;
      const content = delta?.content;
      const reasoning_content = (delta as any)?.reasoning_content || '';
      Logger.debug(
        `思考流delta - hasContent: ${Boolean(content)}, hasReasoning: ${Boolean(
          reasoning_content,
        )}, toolCalls: ${delta?.tool_calls?.length || 0}`,
        'OpenAIChatService',
      );
      thinkStats.contentChars += content?.length || 0;
      thinkStats.reasoningChars += reasoning_content?.length || 0;

      if (shouldLogProgressHeartbeat(thinkStats.eventCount, thinkStats.lastLogAt, now, 20, 10000)) {
        thinkStats.lastLogAt = now;
        this.logTrace('debug', traceId, '深度思考流心跳', {
          durationMs: now - thinkStartedAt,
          stream: this.getHeartbeatSnapshot(thinkStats, now, thinkStartedAt),
        });
      }

      // 根据已确定的思考流来源类型处理数据
      if (thinkingSourceType === 'reasoning_content') {
        // 已确定使用reasoning_content字段
        if (reasoning_content) {
          Logger.debug(
            `继续接收reasoning_content思考流: ${reasoning_content}`,
            'OpenAIChatService',
          );
          result.reasoning_content = [
            {
              type: 'text',
              text: reasoning_content,
            },
          ];
          result.full_reasoning_content += reasoning_content;
          onProgress?.({
            reasoning_content: result.reasoning_content,
          });
        } else if (content && !content.includes('<think>')) {
          // 如果出现普通content，对于非DeepSeek模型终止思考流
          // 对于DeepSeek模型，将内容作为正常响应处理
          Logger.debug(`reasoning_content模式下收到普通content: ${content}`, 'OpenAIChatService');
          if (deepThinkingType === 2) {
            result.content = [
              {
                type: 'text',
                text: content,
              },
            ];
            result.full_content += content;
            onProgress?.({
              content: result.content,
            });
          } else {
            shouldEndThinkStream = true;
          }
        }
        continue;
      } else if (thinkingSourceType === 'think_tag') {
        // 已确定使用think标签
        if (content) {
          if (content.includes('</think>')) {
            // 如果包含结束标签，提取剩余思考内容
            Logger.debug(`检测到</think>标签，思考流结束`, 'OpenAIChatService');
            const regex = /([\s\S]*?)<\/think>([\s\S]*)/;
            const matches = content.match(regex);

            if (matches) {
              const thinkContent = matches[1] || '';
              const remainingContent = matches[2] || '';

              if (thinkContent) {
                result.reasoning_content = [
                  {
                    type: 'text',
                    text: thinkContent,
                  },
                ];
                result.full_reasoning_content += thinkContent;
                onProgress?.({
                  reasoning_content: result.reasoning_content,
                });
              }

              // 对于DeepSeek模型，如果有剩余内容，作为正常响应处理
              if (deepThinkingType === 2 && remainingContent) {
                result.content = [
                  {
                    type: 'text',
                    text: remainingContent,
                  },
                ];
                result.full_content += remainingContent;
                onProgress?.({
                  content: result.content,
                });
              }
            }

            // 对于非DeepSeek模型，终止思考流
            // 对于DeepSeek模型，只标记思考流结束，但继续处理后续内容
            if (deepThinkingType !== 2) {
              shouldEndThinkStream = true;
            } else {
              thinkingSourceType = 'normal_content';
            }
          } else {
            // 继续接收think标签内的思考内容
            Logger.debug(`继续接收think标签思考流: ${content}`, 'OpenAIChatService');
            result.reasoning_content = [
              {
                type: 'text',
                text: content,
              },
            ];
            result.full_reasoning_content += content;
            onProgress?.({
              reasoning_content: result.reasoning_content,
            });
          }
        }
        continue;
      } else if (thinkingSourceType === 'normal_content' && deepThinkingType === 2) {
        // DeepSeek模型在思考流结束后的正常内容处理
        if (content) {
          result.content = [
            {
              type: 'text',
              text: content,
            },
          ];
          result.full_content += content;
          onProgress?.({
            content: result.content,
          });
        }
        continue;
      }

      // 尚未确定思考流来源类型，进行检测
      if (reasoning_content) {
        // 确定使用reasoning_content字段作为思考流
        Logger.debug(
          `首次检测到reasoning_content，确定使用reasoning_content思考流方式: ${reasoning_content}`,
          'OpenAIChatService',
        );
        thinkingSourceType = 'reasoning_content';
        result.reasoning_content = [
          {
            type: 'text',
            text: reasoning_content,
          },
        ];
        result.full_reasoning_content += reasoning_content;
        onProgress?.({
          reasoning_content: result.reasoning_content,
        });
      } else if (content) {
        if (content.includes('<think>')) {
          // 确定使用think标签作为思考流
          Logger.debug(`首次检测到<think>标签，确定使用think标签思考流方式`, 'OpenAIChatService');
          thinkingSourceType = 'think_tag';

          // 提取第一个块中的内容
          const thinkContent = content.replace(/<think>/, '');
          if (thinkContent) {
            Logger.debug(`从<think>标签中提取的初始思考内容: ${thinkContent}`, 'OpenAIChatService');
            result.reasoning_content = [
              {
                type: 'text',
                text: thinkContent,
              },
            ];
            result.full_reasoning_content += thinkContent;
            onProgress?.({
              reasoning_content: result.reasoning_content,
            });

            // 如果已经包含了</think>标签，提取思考内容和剩余内容
            if (content.includes('</think>')) {
              Logger.debug('在首个块中检测到</think>标签', 'OpenAIChatService');

              const regex = /<think>([\s\S]*?)<\/think>([\s\S]*)/;
              const matches = content.match(regex);

              if (matches) {
                const fullThinkContent = matches[1] || '';
                const remainingContent = matches[2] || '';

                // 更新思考内容
                result.reasoning_content = [
                  {
                    type: 'text',
                    text: fullThinkContent,
                  },
                ];
                result.full_reasoning_content = fullThinkContent;
                onProgress?.({
                  reasoning_content: result.reasoning_content,
                });

                // 对于DeepSeek模型，如果有剩余内容，作为正常响应处理
                if (deepThinkingType === 2 && remainingContent) {
                  result.content = [
                    {
                      type: 'text',
                      text: remainingContent,
                    },
                  ];
                  result.full_content += remainingContent;
                  onProgress?.({
                    content: result.content,
                  });
                }
              }

              // 对于非DeepSeek模型，终止思考流
              // 对于DeepSeek模型，只标记思考流结束，继续处理后续内容
              if (deepThinkingType !== 2) {
                shouldEndThinkStream = true;
              } else {
                thinkingSourceType = 'normal_content';
              }
            }
          }
        } else {
          // 没有任何思考流标记，不同模型有不同处理
          Logger.debug(`没有检测到思考流标记，处理普通内容: ${content}`, 'OpenAIChatService');

          if (deepThinkingType === 2) {
            // DeepSeek模型直接处理为正常内容
            thinkingSourceType = 'normal_content';
            result.content = [
              {
                type: 'text',
                text: content,
              },
            ];
            result.full_content += content;
            onProgress?.({
              content: result.content,
            });
          } else {
            // 非DeepSeek模型终止思考流
            shouldEndThinkStream = true;
          }
        }
      }
    }

    Logger.debug('思考流处理完成', 'OpenAIChatService');
    this.logTrace('debug', traceId, '深度思考流处理完成', {
      durationMs: Date.now() - thinkStartedAt,
      fullContentLength: result.full_content.length,
      fullReasoningLength: result.full_reasoning_content.length,
      shouldEndRequest: deepThinkingType === 2 && result.full_content.length > 0,
      stream: this.getHeartbeatSnapshot(thinkStats, Date.now(), thinkStartedAt),
    });

    // 如果是DeepSeek模型并且有内容，直接返回true表示应该终止请求
    return deepThinkingType === 2 && result.full_content.length > 0;
  }

  private async handlePiGatewayChat(
    messagesHistory: any,
    inputs: {
      chatId?: number;
      groupId?: number;
      model: any;
      max_tokens?: any;
      searchResults?: any[];
      images?: string[];
      abortController: AbortController;
      sessionId: string;
      userId?: number;
      researchMode?: boolean;
      usingNetwork?: boolean;
      usingDeepThinking?: boolean;
      traceId?: string;
      onProgress?: (data: any) => void;
    },
    result: any,
  ): Promise<void> {
    const {
      model,
      max_tokens,
      searchResults,
      images,
      abortController,
      sessionId,
      userId,
      researchMode,
      usingNetwork,
      usingDeepThinking,
      traceId,
      onProgress,
      groupId,
      chatId,
    } = inputs;
    const workspaceDir = groupId
      ? resolveConversationWorkspace(groupId)
      : `conversations/chat-${chatId || result.chatId}`;
    const runtimeGroupId = groupId || `chat-${chatId || result.chatId}`;
    const piGatewayUrl = this.buildPiGatewayUrl(
      await this.resolvePiGatewayBaseUrl({
        groupId: runtimeGroupId,
        traceId,
        userId,
      }),
      '/v1/chat/completions',
    );

    const processedMessages = this.prepareSystemMessage(
      messagesHistory,
      {
        searchResults,
        images,
      },
      result,
    );

    Logger.debug(
      `PI gateway request - sessionId: ${sessionId}, model: ${model}, messageCount: ${processedMessages.length}, workspaceDir: ${workspaceDir}`,
      'OpenAIChatService',
    );
    const gatewayStartedAt = Date.now();
    const gatewayStats: StreamHeartbeatStats = {
      chunkCount: 0,
      eventCount: 0,
      contentChars: 0,
      reasoningChars: 0,
      firstChunkAt: null,
      lastChunkAt: null,
      lastLogAt: gatewayStartedAt,
    };
    const webSearchEnabled = resolveRequestedWebSearchEnabled({
      researchMode: researchMode,
      usingNetwork,
    });
    const webSearchLimit = resolveRequestedWebSearchLimit({
      researchMode: researchMode,
      usingNetwork,
    });
    const webSearchProfile = webSearchEnabled
      ? await this.netSearchService.getWebSearchCapabilityProfile(
          researchMode ? 'research' : 'chat',
        )
      : undefined;
    if (!userId) {
      throw new Error('缺少用户 ID，无法创建 PI 内部模型代理');
    }
    const { agentRunId, modelProxy } = await this.agentModelProxyService.createRun({
      chatId,
      groupId,
      model,
      proxyBaseUrl: this.piRuntimeManagerService.resolveInternalModelProxyBaseUrl(),
      traceId,
      userId,
      usingDeepThinking,
    });
    result.agentRunId = agentRunId;
    this.logTrace('log', traceId, '开始请求 PI gateway', {
      agentRunId,
      imageCount: images?.length || 0,
      maxTokens: max_tokens || null,
      messageCount: processedMessages.length,
      model,
      searchResultCount: searchResults?.length || 0,
      sessionId,
      researchMode: researchMode ?? null,
      usingNetwork: usingNetwork ?? null,
      webSearchEnabled,
      webSearchLimit,
      url: piGatewayUrl,
      workspaceDir,
    });

    const response = await fetch(piGatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: processedMessages,
        stream: true,
        session_id: sessionId,
        group_id: groupId,
        max_tokens,
        workspace_dir: workspaceDir,
        web_search_enabled: webSearchEnabled,
        web_search_limit: webSearchLimit,
        web_search_profile: webSearchProfile,
        model_proxy: modelProxy,
      }),
      signal: abortController.signal,
    });

    this.logTrace('debug', traceId, 'PI gateway 已返回响应头', {
      durationMs: Date.now() - gatewayStartedAt,
      ok: response.ok,
      sessionId,
      status: response.status,
      statusText: response.statusText,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      this.logTrace('error', traceId, 'PI gateway 响应异常', {
        durationMs: Date.now() - gatewayStartedAt,
        errorText,
        hasBody: Boolean(response.body),
        sessionId,
        status: response.status,
      });
      throw new Error(`PI gateway request failed: ${response.status} ${errorText}`.trim());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallState>();
    const toolExecutions = new Map<string, ToolExecutionState>();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (abortController.signal.aborted) {
        this.logTrace('warn', traceId, 'PI gateway 流读取因 abort 中断', {
          durationMs: Date.now() - gatewayStartedAt,
          sessionId,
          stream: this.getHeartbeatSnapshot(gatewayStats, Date.now(), gatewayStartedAt),
        });
        break;
      }

      const now = Date.now();
      gatewayStats.chunkCount += 1;
      gatewayStats.eventCount += 1;
      if (!gatewayStats.firstChunkAt) {
        gatewayStats.firstChunkAt = now;
        this.logTrace('debug', traceId, '收到 PI gateway 首个原始 chunk', {
          chunkBytes: value?.length || 0,
          delayMs: now - gatewayStartedAt,
          sessionId,
        });
      }
      gatewayStats.lastChunkAt = now;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      if (
        shouldLogProgressHeartbeat(gatewayStats.eventCount, gatewayStats.lastLogAt, now, 20, 10000)
      ) {
        gatewayStats.lastLogAt = now;
        this.logTrace('debug', traceId, 'PI gateway 流心跳', {
          bufferLength: buffer.length,
          durationMs: now - gatewayStartedAt,
          sessionId,
          stream: this.getHeartbeatSnapshot(gatewayStats, now, gatewayStartedAt),
        });
      }

      for (const event of events) {
        const lines = event
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue;
          }

          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') {
            continue;
          }

          let chunk: PiGatewayChunk;
          try {
            chunk = JSON.parse(payload) as PiGatewayChunk;
          } catch {
            this.logTrace('warn', traceId, 'PI gateway chunk 解析失败', {
              payloadPreview: payload.slice(0, 500),
              payloadLength: payload.length,
              sessionId,
            });
            continue;
          }

          if (chunk.error?.message) {
            this.logTrace('error', traceId, 'PI gateway chunk 返回错误', {
              durationMs: Date.now() - gatewayStartedAt,
              errorMessage: chunk.error.message,
              sessionId,
            });
            throw new Error(chunk.error.message);
          }

          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          if (choice?.finish_reason) {
            result.finishReason = choice.finish_reason;
          }

          if (!delta) {
            continue;
          }

          if (delta.reasoning_content) {
            gatewayStats.reasoningChars += delta.reasoning_content.length;
            result.reasoning_content = [
              {
                type: 'text',
                text: delta.reasoning_content,
              },
            ];
            result.full_reasoning_content += delta.reasoning_content;
            onProgress?.({
              reasoning_content: result.reasoning_content,
            });
          }

          if (delta.content) {
            gatewayStats.contentChars += delta.content.length;
            result.content = [
              {
                type: 'text',
                text: delta.content,
              },
            ];
            result.full_content += delta.content;
            onProgress?.({
              content: result.content,
            });
          }

          if (delta.network_search_result) {
            result.networkSearchResult = delta.network_search_result;
            onProgress?.({
              networkSearchResult: result.networkSearchResult,
            });
          }

          if (delta.tool_execution?.tool_call_id && delta.tool_execution?.tool_name) {
            const toolExecution = mergeToolExecutionState(
              toolExecutions.get(delta.tool_execution.tool_call_id),
              {
                tool_call_id: delta.tool_execution.tool_call_id,
                tool_name: delta.tool_execution.tool_name,
                event: delta.tool_execution.event,
                phase: delta.tool_execution.phase,
                kind: delta.tool_execution.kind,
                step: delta.tool_execution.step,
                step_title: delta.tool_execution.step_title,
                display_title: delta.tool_execution.display_title,
                display_subtitle: delta.tool_execution.display_subtitle,
                target: delta.tool_execution.target,
                progress: delta.tool_execution.progress,
                args_complete: delta.tool_execution.args_complete,
                args_preview: delta.tool_execution.args_preview,
                is_error: delta.tool_execution.is_error,
                result_preview: delta.tool_execution.result_preview,
              },
            );

            toolExecutions.set(toolExecution.tool_call_id, toolExecution);
            onProgress?.(buildToolExecutionProgressDelta(toolExecution));
          }

          if (delta.tool_calls?.length) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index ?? 0;
              toolCalls.set(
                index,
                mergeToolCallState(toolCalls.get(index), {
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: toolCall.function?.name,
                    arguments: toolCall.function?.arguments,
                  },
                }),
              );
            }
          }
        }
      }
    }

    buffer += decoder.decode();

    if (toolCalls.size > 0) {
      result.tool_calls = serializeToolCallStates(
        [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, toolCall]) => toolCall),
      );
    }

    if (toolExecutions.size > 0) {
      result.tool_execution = serializeToolExecutionStates(toolExecutions.values());
    }

    this.logTrace('log', traceId, 'PI gateway 流处理完成', {
      agentRunId,
      durationMs: Date.now() - gatewayStartedAt,
      finishReason: result.finishReason || null,
      fullContentLength: result.full_content.length,
      fullReasoningLength: result.full_reasoning_content.length,
      sessionId,
      stream: this.getHeartbeatSnapshot(gatewayStats, Date.now(), gatewayStartedAt),
      toolCallCount: toolCalls.size,
      toolExecutionCount: toolExecutions.size,
    });
  }

  /**
   * 处理常规响应逻辑
   * @param messagesHistory 消息历史
   * @param inputs 输入参数
   * @param result 结果对象
   */
  private async handleRegularResponse(
    messagesHistory: any,
    inputs: {
      apiKey: any;
      model: any;
      proxyUrl: any;
      timeout: any;
      temperature: any;
      max_tokens?: any;
      extraParam?: any;
      searchResults?: any[];
      images?: string[];
      abortController: AbortController;
      onProgress?: (data: any) => void;
    },
    result: any,
  ): Promise<void> {
    const {
      apiKey,
      model,
      proxyUrl,
      timeout,
      temperature,
      max_tokens,
      searchResults,
      images,
      abortController,
      onProgress,
    } = inputs;

    // 步骤1: 准备和增强系统消息
    const processedMessages = this.prepareSystemMessage(
      messagesHistory,
      {
        searchResults,
        images,
      },
      result,
    );

    // 步骤2: 处理OpenAI聊天API调用
    await this.handleOpenAIChat(
      processedMessages,
      {
        apiKey,
        model,
        proxyUrl,
        timeout,
        temperature,
        max_tokens,
        abortController,
        onProgress,
      },
      result,
    );
  }

  async chat(
    messagesHistory: any,
    inputs: {
      chatId: any;
      userId?: number;
      groupId?: any;
      maxModelTokens?: any;
      max_tokens?: any;
      apiKey: any;
      model: any;
      modelName: any;
      temperature: any;
      modelType?: any;
      prompt?: any;
      imageUrl?: any;
      isFileUpload: any;
      isImageUpload?: any;
      fileUrl?: any;
      usingNetwork?: boolean;
      timeout: any;
      proxyUrl: any;
      modelAvatar?: any;
      usingDeepThinking?: boolean;
      researchMode?: boolean;
      usingMcpTool?: boolean;
      isMcpTool?: boolean;
      extraParam?: any;
      deepThinkingType?: any;
      traceId?: string;
      onProgress?: (data: {
        text?: string;
        content?: [];
        reasoning_content?: [];
        tool_execution?: string;
        tool_execution_delta?: ToolExecutionState;
        tool_calls?: string;
        networkSearchResult?: string;
        finishReason?: string;
        // full_json?: string; // 编辑模式相关，已注释
      }) => void;
      onFailure?: (error: any) => void;
      onDatabase?: (data: any) => void;
      abortController: AbortController;
    },
  ) {
    const {
      chatId,
      maxModelTokens,
      max_tokens,
      apiKey,
      model,
      modelName,
      temperature,
      prompt,
      timeout,
      proxyUrl,
      modelAvatar,
      usingDeepThinking,
      researchMode,
      usingNetwork,
      extraParam,
      deepThinkingType,
      onProgress,
      onFailure,
      onDatabase,
      abortController,
      traceId,
    } = inputs;
    let agentBilling: AgentRunSettlement | null = null;

    // 创建原始消息历史的副本
    const originalMessagesHistory = JSON.parse(JSON.stringify(messagesHistory));

    const result: any = {
      chatId,
      modelName,
      modelAvatar,
      model,
      status: 2,
      full_content: '',
      full_reasoning_content: '',
      networkSearchResult: '',
      fileVectorResult: '',
      tool_execution: '',
      finishReason: null,
    };

    try {
      // 普通联网搜索由 PI web_search 工具执行并回灌给模型；service 不再提前搜索后硬塞 prompt。
      const searchResults: any[] = [];
      const images: string[] = [];

      // 步骤5: 处理深度思考
      const shouldEndRequest = await this.handleDeepThinking(
        messagesHistory,
        {
          apiKey,
          model,
          proxyUrl,
          timeout,
          usingDeepThinking,
          searchResults,
          abortController,
          deepThinkingType,
          traceId,
          onProgress,
        },
        result,
      );

      // 如果深度思考处理后应该终止请求，则直接返回结果
      if (shouldEndRequest) {
        result.content = '';
        result.reasoning_content = '';
        result.finishReason = result.finishReason || 'stop';
        return result;
      }

      // 步骤6: 处理常规响应
      await this.handlePiGatewayChat(
        originalMessagesHistory,
        {
          model,
          max_tokens,
          searchResults,
          images,
          abortController,
          onProgress,
          traceId,
          sessionId: inputs.groupId ? `group-${inputs.groupId}` : `chat-${chatId}`,
          groupId: inputs.groupId,
          chatId,
          researchMode,
          usingNetwork,
          usingDeepThinking,
          userId: inputs.userId,
        },
        result,
      );
      agentBilling = await this.agentModelProxyService.settleRun(result.agentRunId);
      result.agentBilling = agentBilling;

      result.content = [
        {
          type: 'text',
          text: '',
        },
      ];
      result.reasoning_content = [
        {
          type: 'text',
          text: '',
        },
      ];
      result.finishReason = result.finishReason || 'stop';

      return result;
    } catch (error) {
      if (result.agentRunId && !agentBilling) {
        try {
          agentBilling = await this.agentModelProxyService.settleRun(result.agentRunId);
          result.agentBilling = agentBilling;
        } catch (settleError) {
          this.logTrace('error', traceId, 'Agent 模型代理用量结算失败', {
            agentRunId: result.agentRunId,
            error: serializeErrorForLog(settleError),
          });
        }
      }
      const errorMessage = handleError(error);
      Logger.error(`对话请求失败: ${errorMessage}`, 'OpenAIChatService');
      this.logTrace('error', traceId, '对话请求失败', {
        chatId,
        error: serializeErrorForLog(error),
        finishReason: result.finishReason || null,
        fullContentLength: result.full_content.length,
        fullReasoningLength: result.full_reasoning_content.length,
        model,
      });
      result.errMsg = errorMessage;
      onFailure?.(result);
      return result;
    }
  }

  async chatFree(
    prompt: string,
    systemMessage?: string,
    messagesHistory?: any[],
    imageUrl?: any,
    modelConfig?: {
      apiKey?: string;
      model?: string;
      proxyUrl?: string;
      timeout?: number;
    },
  ) {
    const {
      openaiBaseUrl = '',
      openaiBaseKey = '',
      openaiBaseModel,
    } = await this.globalConfigService.getConfigs([
      'openaiBaseKey',
      'openaiBaseUrl',
      'openaiBaseModel',
    ]);

    const key = modelConfig?.apiKey || openaiBaseKey;
    const proxyUrl = modelConfig?.proxyUrl || openaiBaseUrl;

    let requestData = [];

    if (systemMessage) {
      requestData.push({
        role: 'system',
        content: systemMessage,
      });
    }

    if (messagesHistory && messagesHistory.length > 0) {
      requestData = requestData.concat(messagesHistory);
    } else {
      if (imageUrl) {
        requestData.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        });
      } else {
        requestData.push({
          role: 'user',
          content: prompt,
        });
      }
    }

    try {
      const openai = new OpenAI({
        apiKey: key,
        baseURL: await correctApiBaseUrl(proxyUrl),
      });

      const requestModel = modelConfig?.model || openaiBaseModel || 'gpt-4o-mini';
      const requestTimeout = modelConfig?.timeout || 30000;
      const response = await openai.chat.completions.create(
        {
          model: requestModel,
          messages: requestData,
        },
        {
          timeout: requestTimeout,
        },
      );

      const content = response.choices[0].message.content;
      if (content) {
        return content;
      }

      const stream = (await openai.chat.completions.create(
        {
          model: requestModel,
          messages: requestData,
          stream: true,
        },
        {
          timeout: requestTimeout,
        },
      )) as any;

      let streamedContent = '';
      for await (const chunk of stream) {
        streamedContent += chunk?.choices?.[0]?.delta?.content || '';
      }

      return streamedContent || content;
    } catch (error) {
      const errorMessage = handleError(error);
      Logger.error(`全局模型调用失败: ${errorMessage}`, 'OpenAIChatService');
      return;
    }
  }

  /**
   * 准备和增强系统消息
   * @param messagesHistory 消息历史
   * @param inputs 输入参数
   * @param result 结果对象
   * @returns 处理后的消息历史
   */
  private prepareSystemMessage(
    messagesHistory: any,
    inputs: {
      searchResults?: any[];
      images?: string[];
    },
    result: any,
  ): any {
    const { searchResults, images } = inputs;

    // 创建消息历史的副本
    const processedMessages = JSON.parse(JSON.stringify(messagesHistory));

    // 查找系统消息
    const systemMessage = processedMessages?.find((message: any) => message.role === 'system');

    if (systemMessage) {
      const imageUrlMessages =
        processedMessages?.filter((message: any) => message.type === 'image_url') || [];

      let updatedContent = '';

      // 添加推理思考内容
      if (result.full_reasoning_content) {
        updatedContent = `\n\n以下是针对这个问题的思考推理思路（思路不一定完全正确，仅供参考）：\n${result.full_reasoning_content}`;
      }

      // 添加网络搜索结果
      if (searchResults && searchResults.length > 0) {
        // 将 searchResult 转换为 JSON 字符串
        let searchPrompt = JSON.stringify(searchResults, null, 2); // 格式化为漂亮的 JSON 字符串

        // 处理图片数据
        let imagesPrompt = '';
        if (images && images.length > 0) {
          imagesPrompt = `\n\n以下是搜索到的相关图片链接:\n${images.join('\n')}`;
        }

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

        updatedContent += `
          \n\n你的任务是根据用户的问题，通过下面的搜索结果提供更精确、详细、具体的回答。
          请在适当的情况下在对应部分句子末尾标注引用的链接，使用[[序号](链接地址)]格式，同时使用多个链接可连续使用比如[[2](链接地址)][[5](链接地址)]，以下是搜索结果：
            ${searchPrompt}${imagesPrompt}
            在回答时，请注意以下几点：
              - 现在时间是: ${currentDate}。
              - 如果结果中包含图片链接，可在适当位置使用MarkDown格式插入至少一张图片，让回答图文并茂。
              - 并非搜索结果的所有内容都与用户的问题密切相关，你需要结合问题，对搜索结果进行甄别、筛选。
              - 对于列举类的问题（如列举所有航班信息），尽量将答案控制在10个要点以内，并告诉用户可以查看搜索来源、获得完整信息。优先提供信息完整、最相关的列举项；如非必要，不要主动告诉用户搜索结果未提供的内容。
              - 对于创作类的问题（如写论文），请务必在正文的段落中引用对应的参考编号。你需要解读并概括用户的题目要求，选择合适的格式，充分利用搜索结果并抽取重要信息，生成符合用户要求、极具思想深度、富有创造力与专业性的答案。你的创作篇幅需要尽可能延长，对于每一个要点的论述要推测用户的意图，给出尽可能多角度的回答要点，且务必信息量大、论述详尽。
              - 如果回答很长，请尽量结构化、分段落总结。如果需要分点作答，尽量控制在5个点以内，并合并相关的内容。
              - 对于客观类的问答，如果问题的答案非常简短，可以适当补充一到两句相关信息，以丰富内容。
              - 你需要根据用户要求和回答内容选择合适、美观的回答格式，确保可读性强。
              - 你的回答应该综合多个相关网页来回答，不能只重复引用一个网页。
              - 除非用户要求，否则你回答的语言需要和用户提问的语言保持一致。
            `;
      }

      // 添加图片URL消息
      if (imageUrlMessages && imageUrlMessages.length > 0) {
        imageUrlMessages.forEach((imageMessage: any) => {
          updatedContent = `${updatedContent}\n${JSON.stringify(imageMessage)}`;
        });
      }

      systemMessage.content += updatedContent;
    }

    return processedMessages;
  }

  /**
   * 处理OpenAI聊天API调用和流式响应
   * @param messagesHistory 处理后的消息历史
   * @param inputs 输入参数
   * @param result 结果对象
   */
  private async handleOpenAIChat(
    messagesHistory: any,
    inputs: {
      apiKey: any;
      model: any;
      proxyUrl: any;
      timeout: any;
      temperature: any;
      max_tokens?: any;
      abortController: AbortController;
      onProgress?: (data: any) => void;
    },
    result: any,
  ): Promise<void> {
    const {
      apiKey,
      model,
      proxyUrl,
      timeout,
      temperature,
      max_tokens,
      abortController,
      onProgress,
    } = inputs;

    // 准备请求数据
    const streamData = {
      model,
      messages: messagesHistory,
      stream: true,
      temperature,
    };

    // 创建OpenAI实例
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: await correctApiBaseUrl(proxyUrl),
      timeout: timeout,
    });

    try {
      Logger.debug(
        `对话请求 - model: ${streamData.model}, messageCount: ${streamData.messages.length}`,
        'OpenAIChatService',
      );

      // 发送流式请求
      const stream = await openai.chat.completions.create(
        {
          model: streamData.model,
          messages: streamData.messages,
          stream: true,
          max_tokens: max_tokens,
          temperature: streamData.temperature,
        },
        {
          signal: abortController.signal,
        },
      );

      // 处理流式响应
      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          break;
        }

        const content = chunk.choices[0]?.delta?.content || '';

        if (content) {
          // 处理流式内容
          result.content = [
            {
              type: 'text',
              text: content,
            },
          ];

          result.full_content += content;
          onProgress?.({
            content: result.content,
          });
        }
      }
    } catch (error) {
      Logger.error(`OpenAI请求失败: ${handleError(error)}`, 'OpenAIChatService');
      throw error;
    }
  }
}
