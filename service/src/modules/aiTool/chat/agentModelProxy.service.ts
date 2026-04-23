import { correctApiBaseUrl } from '@/common/utils/correctApiBaseUrl';
import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { GlobalConfigService } from '../../globalConfig/globalConfig.service';
import { ModelsService } from '../../models/models.service';
import { RedisCacheService } from '../../redisCache/redisCache.service';
import { UserBalanceService } from '../../userBalance/userBalance.service';
import {
  AgentRunSettlement,
  AgentUsageLedger,
  calculateAgentRunCharge,
  createAgentModelProxyToken,
  createEmptyAgentUsageLedger,
  OpenAiUsagePayload,
  recordOpenAiUsage,
  verifyAgentModelProxyToken,
} from './agentModelProxy';

type CreateAgentRunInput = {
  chatId?: number;
  groupId?: number;
  model: string;
  proxyBaseUrl: string;
  traceId?: string;
  userId: number;
  usingDeepThinking?: boolean;
};

const TOKEN_TTL_MS = 30 * 60 * 1000;
const LEDGER_TTL_SECONDS = 60 * 60 * 2;
const DEFAULT_PROXY_CONTEXT_WINDOW = 128000;
const DEFAULT_PROXY_MAX_TOKENS = 8192;
const UPSTREAM_MAX_ATTEMPTS = 3;
const UPSTREAM_BASE_RETRY_DELAY_MS = 500;
const UPSTREAM_MAX_RETRY_AFTER_MS = 5_000;
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

type UpstreamSuccess = {
  attempt: number;
  response: globalThis.Response;
};

type UpstreamFailure = {
  attempt: number;
  bodyPreview: string;
  message: string;
  response?: globalThis.Response;
  status: number;
};

type UpstreamResult = UpstreamSuccess | UpstreamFailure;
type UpstreamApiFormat = 'anthropic' | 'openai';
type AnthropicUsagePayload = {
  input_tokens?: number;
  output_tokens?: number;
};

@Injectable()
export class AgentModelProxyService {
  constructor(
    private readonly globalConfigService: GlobalConfigService,
    private readonly modelsService: ModelsService,
    private readonly redisCacheService: RedisCacheService,
    private readonly userBalanceService: UserBalanceService,
  ) {}

  async createRun(input: CreateAgentRunInput) {
    const jwtSecret = await this.redisCacheService.getJwtSecret();
    const modelDetail = await this.modelsService.getCurrentModelKeyInfo(input.model);
    const agentRunId = `agent_run_${randomUUID()}`;
    const ledger = createEmptyAgentUsageLedger({
      agentRunId,
      chatId: input.chatId,
      groupId: input.groupId,
      model: input.model,
      userId: input.userId,
      usingDeepThinking: input.usingDeepThinking,
    });
    await this.saveLedger(ledger);

    const token = createAgentModelProxyToken(
      {
        agentRunId,
        chatId: input.chatId,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        groupId: input.groupId,
        model: input.model,
        traceId: input.traceId,
        userId: input.userId,
      },
      jwtSecret,
    );

    return {
      agentRunId,
      modelProxy: {
        apiKey: token,
        baseUrl: input.proxyBaseUrl,
        contextWindow: this.resolvePositiveNumber(
          modelDetail?.maxModelTokens,
          DEFAULT_PROXY_CONTEXT_WINDOW,
        ),
        maxTokens: this.resolvePositiveNumber(modelDetail?.max_tokens, DEFAULT_PROXY_MAX_TOKENS),
        model: input.model,
      },
    };
  }

  async proxyChatCompletions(token: string, body: Record<string, any>, res: Response) {
    const claims = await this.verifyToken(token);
    if (body?.model && body.model !== claims.model) {
      throw new Error('agent model proxy token does not allow requested model');
    }

    const { openaiBaseUrl, openaiBaseKey } = await this.globalConfigService.getConfigs([
      'openaiBaseUrl',
      'openaiBaseKey',
    ]);
    const modelDetail = await this.modelsService.getCurrentModelKeyInfo(claims.model);
    const apiKey = modelDetail?.key || openaiBaseKey;
    if (!modelDetail || !apiKey) {
      throw new Error('model key is not configured');
    }

    const baseUrl = await correctApiBaseUrl(modelDetail.proxyUrl || openaiBaseUrl);
    const apiFormat = this.resolveApiFormat(modelDetail?.apiFormat);
    const upstreamUrl = this.buildUpstreamUrl(baseUrl, apiFormat);
    const upstreamBody = this.buildUpstreamBody(body, {
      apiFormat,
      resolvedModel: modelDetail.model || claims.model,
    });
    const upstreamBodyText = JSON.stringify(upstreamBody);
    Logger.debug(
      `[traceId=${claims.traceId || '-'}] agent model proxy request prepared | ${JSON.stringify({
        apiFormat,
        agentRunId: claims.agentRunId,
        bodyBytes: Buffer.byteLength(upstreamBodyText),
        maxTokens: upstreamBody.max_tokens ?? null,
        messageCount: Array.isArray(upstreamBody.messages) ? upstreamBody.messages.length : null,
        model: claims.model,
        stream: body?.stream === true,
        upstreamHost: this.getUrlHost(upstreamUrl),
      })}`,
      AgentModelProxyService.name,
    );

    const upstreamResult = await this.fetchUpstreamWithRetry(
      upstreamUrl,
      {
        body: upstreamBodyText,
        headers: this.buildUpstreamHeaders(apiFormat, apiKey),
        method: 'POST',
      },
      {
        agentRunId: claims.agentRunId,
        model: claims.model,
        stream: body?.stream === true,
        traceId: claims.traceId,
      },
    );
    if ('message' in upstreamResult) {
      res.status(upstreamResult.status);
      res.json({
        error: {
          code: 'upstream_model_error',
          message: upstreamResult.message,
          type: 'server_error',
        },
      });
      return;
    }

    const upstream = upstreamResult.response;
    res.status(upstream.status);
    if (apiFormat === 'anthropic') {
      res.setHeader(
        'Content-Type',
        body?.stream === true ? 'text/event-stream' : 'application/json',
      );
    } else {
      upstream.headers.forEach((value, key) => {
        if (
          !['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())
        ) {
          res.setHeader(key, value);
        }
      });
    }

    if (body?.stream === true && upstream.body) {
      await this.pipeStreamingResponse(
        claims.agentRunId,
        upstream,
        res,
        apiFormat,
        modelDetail.model || claims.model,
        body,
      );
      return;
    }

    const data = await upstream.json().catch(async () => {
      const text = await upstream.text().catch(() => '');
      return text ? { error: { message: text } } : {};
    });
    const normalizedData =
      apiFormat === 'anthropic'
        ? this.convertAnthropicResponseToOpenAi(
            data,
            modelDetail.model || claims.model,
            body?.messages,
          )
        : data;
    await this.recordUsage(claims.agentRunId, normalizedData?.usage);
    res.json(normalizedData);
  }

  private async fetchUpstreamWithRetry(
    upstreamUrl: string,
    init: RequestInit,
    context: {
      agentRunId: string;
      model: string;
      stream: boolean;
      traceId?: string;
    },
  ): Promise<UpstreamResult> {
    for (let attempt = 1; attempt <= UPSTREAM_MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const response = await fetch(upstreamUrl, init);
        const durationMs = Date.now() - startedAt;
        if (response.ok) {
          if (attempt > 1) {
            Logger.log(
              `[traceId=${
                context.traceId || '-'
              }] agent model proxy upstream recovered after retry | ${JSON.stringify({
                agentRunId: context.agentRunId,
                attempt,
                durationMs,
                model: context.model,
                status: response.status,
                stream: context.stream,
                upstreamHost: this.getUrlHost(upstreamUrl),
              })}`,
              AgentModelProxyService.name,
            );
          }
          return { attempt, response };
        }

        const bodyPreview = await this.readBodyPreview(response);
        const retryable = RETRYABLE_UPSTREAM_STATUSES.has(response.status);
        const message = this.buildUpstreamFailureMessage(attempt, response.status, bodyPreview);
        Logger.warn(
          `[traceId=${
            context.traceId || '-'
          }] agent model proxy upstream returned non-2xx | ${JSON.stringify({
            agentRunId: context.agentRunId,
            attempt,
            bodyPreview,
            durationMs,
            model: context.model,
            retryable,
            status: response.status,
            stream: context.stream,
            upstreamHost: this.getUrlHost(upstreamUrl),
          })}`,
          AgentModelProxyService.name,
        );

        if (!retryable || attempt >= UPSTREAM_MAX_ATTEMPTS) {
          return {
            attempt,
            bodyPreview,
            message,
            response,
            status: response.status,
          };
        }

        await this.sleep(this.getRetryDelayMs(attempt, response));
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        Logger.warn(
          `[traceId=${
            context.traceId || '-'
          }] agent model proxy upstream fetch failed | ${JSON.stringify({
            agentRunId: context.agentRunId,
            attempt,
            durationMs,
            error: message,
            model: context.model,
            retryable: true,
            stream: context.stream,
            upstreamHost: this.getUrlHost(upstreamUrl),
          })}`,
          AgentModelProxyService.name,
        );

        if (attempt >= UPSTREAM_MAX_ATTEMPTS) {
          return {
            attempt,
            bodyPreview: '',
            message: `upstream model request failed after ${attempt} attempts: ${message}`,
            status: 502,
          };
        }

        await this.sleep(this.getRetryDelayMs(attempt));
      }
    }

    return {
      attempt: UPSTREAM_MAX_ATTEMPTS,
      bodyPreview: '',
      message: `upstream model request failed after ${UPSTREAM_MAX_ATTEMPTS} attempts`,
      status: 502,
    };
  }

  private buildUpstreamFailureMessage(attempt: number, status: number, bodyPreview: string) {
    const detail = bodyPreview ? `body: ${bodyPreview}` : 'empty body';
    return `upstream model request failed after ${attempt} attempt${
      attempt === 1 ? '' : 's'
    }: HTTP ${status} ${detail}`;
  }

  private async readBodyPreview(response: globalThis.Response) {
    const text = await response.text().catch(() => '');
    return text.slice(0, 1000);
  }

  private getRetryDelayMs(attempt: number, response?: globalThis.Response) {
    const retryAfter = response?.headers.get('retry-after');
    if (retryAfter) {
      const retryAfterMs = this.parseRetryAfterMs(retryAfter);
      if (retryAfterMs !== null) {
        return Math.min(retryAfterMs, UPSTREAM_MAX_RETRY_AFTER_MS);
      }
    }
    return UPSTREAM_BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
  }

  private parseRetryAfterMs(value: string) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  private getUrlHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'unknown';
    }
  }

  private resolvePositiveNumber(value: unknown, fallback: number) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  private sleep(delayMs: number) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  async settleRun(agentRunId?: string): Promise<AgentRunSettlement | null> {
    if (!agentRunId) {
      return null;
    }

    const ledger = await this.getLedger(agentRunId);
    if (!ledger) {
      return null;
    }
    if (ledger.settled) {
      return this.toSettlement(ledger, 0, 0);
    }

    const modelDetail = await this.modelsService.getCurrentModelKeyInfo(ledger.model);
    if (!modelDetail) {
      throw new Error(`agent run model not found: ${ledger.model}`);
    }

    const charge = calculateAgentRunCharge(ledger, {
      deduct: Number(modelDetail.deduct || 0),
      deductDeepThink: Number(modelDetail.deductDeepThink || 1),
      isTokenBased: modelDetail.isTokenBased === true,
      tokenFeeRatio: Number(modelDetail.tokenFeeRatio || 0),
      usingDeepThinking: ledger.usingDeepThinking,
    });

    if (charge > 0 || ledger.totalTokens > 0) {
      await this.userBalanceService.deductFromBalance(
        ledger.userId,
        modelDetail.deductType,
        charge,
        ledger.totalTokens,
      );
      await this.modelsService.saveUseLog(modelDetail.id, ledger.totalTokens);
    }

    ledger.settled = true;
    ledger.updatedAt = Date.now();
    await this.saveLedger(ledger);
    return this.toSettlement(ledger, charge, modelDetail.deductType);
  }

  private async verifyToken(token: string) {
    const jwtSecret = await this.redisCacheService.getJwtSecret();
    return verifyAgentModelProxyToken(token, jwtSecret);
  }

  private ledgerKey(agentRunId: string) {
    return `openwork:agent-run:${agentRunId}`;
  }

  private async getLedger(agentRunId: string): Promise<AgentUsageLedger | null> {
    const raw = await this.redisCacheService.get({ key: this.ledgerKey(agentRunId) });
    return raw ? (JSON.parse(raw) as AgentUsageLedger) : null;
  }

  private async saveLedger(ledger: AgentUsageLedger) {
    await this.redisCacheService.set(
      {
        key: this.ledgerKey(ledger.agentRunId),
        val: JSON.stringify(ledger),
      },
      LEDGER_TTL_SECONDS,
    );
  }

  private async recordUsage(
    agentRunId: string,
    usage?: OpenAiUsagePayload | AnthropicUsagePayload | null,
  ) {
    if (!usage) {
      return;
    }

    const ledger = await this.getLedger(agentRunId);
    if (!ledger || ledger.settled) {
      return;
    }

    recordOpenAiUsage(ledger, this.normalizeUsagePayload(usage));
    await this.saveLedger(ledger);
  }

  private async pipeStreamingResponse(
    agentRunId: string,
    upstream: globalThis.Response,
    res: Response,
    apiFormat: UpstreamApiFormat = 'openai',
    model = '',
    requestBody: Record<string, any> = {},
  ) {
    if (apiFormat === 'anthropic') {
      await this.pipeAnthropicStreamingResponse(agentRunId, upstream, res, model, requestBody);
      return;
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let lastUsage: OpenAiUsagePayload | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(Buffer.from(value));
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(payload);
            if (parsed?.usage) {
              lastUsage = parsed.usage;
            }
          } catch (_error) {
            // Streaming payloads must pass through even if a vendor emits non-JSON diagnostics.
          }
        }
      }
    }

    buffer += decoder.decode();
    await this.recordUsage(agentRunId, lastUsage);
    res.end();
  }

  private toSettlement(
    ledger: AgentUsageLedger,
    charge: number,
    chargeType: number,
  ): AgentRunSettlement {
    return {
      agentRunId: ledger.agentRunId,
      callCount: ledger.callCount,
      charge,
      chargeType,
      completionTokens: ledger.completionTokens,
      model: ledger.model,
      promptTokens: ledger.promptTokens,
      settled: ledger.settled,
      totalTokens: ledger.totalTokens,
    };
  }

  private resolveApiFormat(value: unknown): UpstreamApiFormat {
    return String(value || '').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  }

  private buildUpstreamUrl(baseUrl: string, apiFormat: UpstreamApiFormat) {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    return apiFormat === 'anthropic'
      ? `${normalizedBaseUrl}/messages`
      : `${normalizedBaseUrl}/chat/completions`;
  }

  private buildUpstreamHeaders(apiFormat: UpstreamApiFormat, apiKey: string) {
    if (apiFormat === 'anthropic') {
      return {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      };
    }

    return {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
  }

  private buildUpstreamBody(
    body: Record<string, any>,
    input: {
      apiFormat: UpstreamApiFormat;
      resolvedModel: string;
    },
  ) {
    if (input.apiFormat === 'anthropic') {
      return this.buildAnthropicRequestBody(body, input.resolvedModel);
    }

    return {
      ...body,
      model: input.resolvedModel,
      ...(body?.stream === true
        ? {
            stream_options: {
              ...(body?.stream_options || {}),
              include_usage: true,
            },
          }
        : {}),
    };
  }

  private buildAnthropicRequestBody(body: Record<string, any>, resolvedModel: string) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const systemParts: string[] = [];
    const anthropicMessages: Array<Record<string, any>> = [];

    for (const message of messages) {
      if (!message || typeof message !== 'object') {
        continue;
      }

      if (message.role === 'system') {
        const systemText = this.extractTextFromContent(message.content);
        if (systemText) {
          systemParts.push(systemText);
        }
        continue;
      }

      if (message.role === 'tool') {
        anthropicMessages.push({
          content: [
            {
              content: this.extractTextFromContent(message.content) || '',
              tool_use_id: String(message.tool_call_id || message.toolCallId || ''),
              type: 'tool_result',
            },
          ],
          role: 'user',
        });
        continue;
      }

      const mappedMessage = this.mapMessageToAnthropic(message);
      if (mappedMessage) {
        anthropicMessages.push(mappedMessage);
      }
    }

    const requestBody: Record<string, any> = {
      max_tokens: Number(body?.max_tokens) > 0 ? Number(body.max_tokens) : 4096,
      messages: anthropicMessages,
      model: resolvedModel,
      stream: body?.stream === true,
    };

    if (systemParts.length > 0) {
      requestBody.system = systemParts.join('\n\n');
    }
    if (typeof body?.temperature === 'number') {
      requestBody.temperature = body.temperature;
    }
    if (Array.isArray(body?.tools) && body.tools.length > 0) {
      requestBody.tools = body.tools
        .map((tool: any) => {
          if (tool?.type !== 'function' || !tool.function?.name) {
            return null;
          }
          return {
            description: tool.function.description || '',
            input_schema: tool.function.parameters || {
              additionalProperties: false,
              properties: {},
              type: 'object',
            },
            name: tool.function.name,
          };
        })
        .filter(Boolean);
    }
    if (body?.tool_choice && body.tool_choice !== 'none') {
      requestBody.tool_choice =
        typeof body.tool_choice === 'string'
          ? { type: body.tool_choice === 'required' ? 'any' : 'auto' }
          : body.tool_choice?.function?.name
            ? { name: body.tool_choice.function.name, type: 'tool' }
            : { type: 'auto' };
    }

    return requestBody;
  }

  private mapMessageToAnthropic(message: Record<string, any>) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const contentBlocks: Array<Record<string, any>> = this.convertContentToAnthropicBlocks(
      message.content,
    );

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        contentBlocks.push({
          id: toolCall.id,
          input: this.safeParseJson(toolCall?.function?.arguments) || {},
          name: toolCall?.function?.name || '',
          type: 'tool_use',
        });
      }
    }

    if (contentBlocks.length === 0) {
      return null;
    }

    if (contentBlocks.every(block => block.type === 'text')) {
      return {
        content: contentBlocks.map(block => block.text).join('\n'),
        role,
      };
    }

    return {
      content: contentBlocks,
      role,
    };
  }

  private convertContentToAnthropicBlocks(content: any) {
    if (typeof content === 'string') {
      return content ? [{ text: content, type: 'text' }] : [];
    }

    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .map(item => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        if (item.type === 'text' && item.text) {
          return { text: item.text, type: 'text' };
        }
        if (item.type === 'input_text' && item.text) {
          return { text: item.text, type: 'text' };
        }
        return null;
      })
      .filter(Boolean) as Array<{ text: string; type: 'text' }>;
  }

  private extractTextFromContent(content: any) {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map(item => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        return item.text || item.content || '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private safeParseJson(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private convertAnthropicResponseToOpenAi(
    data: Record<string, any>,
    model: string,
    requestMessages?: any[],
  ) {
    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const textContent = contentBlocks
      .filter(block => block?.type === 'text')
      .map(block => block.text || '')
      .join('');
    const toolCalls = contentBlocks
      .filter(block => block?.type === 'tool_use')
      .map((block, index) => ({
        id: block.id || `call_${index}`,
        index,
        type: 'function',
        function: {
          arguments: JSON.stringify(block.input || {}),
          name: block.name || '',
        },
      }));

    return {
      id: data?.id || `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: this.mapAnthropicStopReason(data?.stop_reason),
          message: {
            role: 'assistant',
            content: textContent || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
        },
      ],
      usage: this.normalizeUsagePayload(data?.usage),
      system_fingerprint: this.buildSystemFingerprint(requestMessages),
    };
  }

  private buildSystemFingerprint(messages?: any[]) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return undefined;
    }
    return 'anthropic-proxy';
  }

  private mapAnthropicStopReason(stopReason: unknown) {
    switch (stopReason) {
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'end_turn':
      default:
        return 'stop';
    }
  }

  private normalizeUsagePayload(
    usage?: OpenAiUsagePayload | AnthropicUsagePayload | null,
  ): OpenAiUsagePayload | null {
    if (!usage) {
      return null;
    }

    if ('prompt_tokens' in usage || 'completion_tokens' in usage || 'total_tokens' in usage) {
      return {
        completion_tokens: Number(usage.completion_tokens || 0),
        prompt_tokens: Number(usage.prompt_tokens || 0),
        total_tokens: Number(
          usage.total_tokens ||
            Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0),
        ),
      };
    }

    const anthropicUsage = usage as AnthropicUsagePayload;
    const promptTokens = Number(anthropicUsage.input_tokens || 0);
    const completionTokens = Number(anthropicUsage.output_tokens || 0);
    return {
      completion_tokens: completionTokens,
      prompt_tokens: promptTokens,
      total_tokens: promptTokens + completionTokens,
    };
  }

  private async pipeAnthropicStreamingResponse(
    agentRunId: string,
    upstream: globalThis.Response,
    res: Response,
    model: string,
    requestBody: Record<string, any>,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const streamId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    let usage: OpenAiUsagePayload | null = null;
    let finishReason: string | null = null;
    let roleSent = false;

    const writeChunk = (payload: Record<string, any> | '[DONE]') => {
      if (payload === '[DONE]') {
        res.write('data: [DONE]\n\n');
        return;
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const parsed = this.parseServerSentEvent(event);
        if (!parsed) {
          continue;
        }

        if (!roleSent && parsed.type === 'message_start') {
          roleSent = true;
          usage = this.normalizeUsagePayload(parsed.message?.usage);
          writeChunk({
            id: streamId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          });
          continue;
        }

        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          writeChunk({
            id: streamId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: parsed.delta.text || '' },
                finish_reason: null,
              },
            ],
          });
          continue;
        }

        if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
          writeChunk({
            id: streamId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: parsed.index || 0,
                      id: parsed.content_block.id || `call_${parsed.index || 0}`,
                      type: 'function',
                      function: {
                        name: parsed.content_block.name || '',
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
          continue;
        }

        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
          writeChunk({
            id: streamId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: parsed.index || 0,
                      function: {
                        arguments: parsed.delta.partial_json || '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
          continue;
        }

        if (parsed.type === 'message_delta') {
          const normalizedUsage = this.normalizeUsagePayload(parsed.usage);
          if (normalizedUsage) {
            usage = {
              completion_tokens: Number(
                normalizedUsage.completion_tokens || usage?.completion_tokens || 0,
              ),
              prompt_tokens: Number(normalizedUsage.prompt_tokens || usage?.prompt_tokens || 0),
              total_tokens:
                Number(normalizedUsage.prompt_tokens || usage?.prompt_tokens || 0) +
                Number(normalizedUsage.completion_tokens || usage?.completion_tokens || 0),
            };
          }
          finishReason = this.mapAnthropicStopReason(parsed.delta?.stop_reason);
        }
      }
    }

    buffer += decoder.decode();

    writeChunk({
      id: streamId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason || 'stop',
        },
      ],
    });

    if (requestBody?.stream_options?.include_usage === true && usage) {
      writeChunk({
        id: streamId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [],
        usage,
      });
    }

    writeChunk('[DONE]');
    await this.recordUsage(agentRunId, usage);
    res.end();
  }

  private parseServerSentEvent(rawEvent: string) {
    const dataLines: string[] = [];

    for (const line of rawEvent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      dataLines.push(trimmed.slice(5).trim());
    }

    if (dataLines.length === 0) {
      return null;
    }

    const payload = dataLines.join('\n');
    if (!payload || payload === '[DONE]') {
      return null;
    }

    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}
