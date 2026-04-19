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
    const upstreamUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const upstreamBody: Record<string, any> = {
      ...body,
      model: modelDetail.model || claims.model,
      ...(body?.stream === true
        ? {
            stream_options: {
              ...(body?.stream_options || {}),
              include_usage: true,
            },
          }
        : {}),
    };
    const upstreamBodyText = JSON.stringify(upstreamBody);
    Logger.debug(
      `[traceId=${claims.traceId || '-'}] agent model proxy request prepared | ${JSON.stringify({
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
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
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
    upstream.headers.forEach((value, key) => {
      if (
        !['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())
      ) {
        res.setHeader(key, value);
      }
    });

    if (body?.stream === true && upstream.body) {
      await this.pipeStreamingResponse(claims.agentRunId, upstream, res);
      return;
    }

    const data = await upstream.json().catch(async () => {
      const text = await upstream.text().catch(() => '');
      return text ? { error: { message: text } } : {};
    });
    await this.recordUsage(claims.agentRunId, data?.usage);
    res.json(data);
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

  private async recordUsage(agentRunId: string, usage?: OpenAiUsagePayload | null) {
    if (!usage) {
      return;
    }

    const ledger = await this.getLedger(agentRunId);
    if (!ledger || ledger.settled) {
      return;
    }

    recordOpenAiUsage(ledger, usage);
    await this.saveLedger(ledger);
  }

  private async pipeStreamingResponse(
    agentRunId: string,
    upstream: globalThis.Response,
    res: Response,
  ) {
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
}
