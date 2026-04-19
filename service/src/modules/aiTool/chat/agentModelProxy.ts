import { createHmac, timingSafeEqual } from 'node:crypto';

export type AgentModelProxyClaims = {
  agentRunId: string;
  chatId?: number;
  expiresAt: number;
  groupId?: number;
  model: string;
  traceId?: string;
  userId: number;
};

export type AgentUsageLedger = {
  agentRunId: string;
  callCount: number;
  chatId?: number;
  completionTokens: number;
  createdAt: number;
  groupId?: number;
  model: string;
  promptTokens: number;
  settled: boolean;
  totalTokens: number;
  updatedAt: number;
  userId: number;
  usingDeepThinking: boolean;
};

export type OpenAiUsagePayload = {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
};

export type AgentRunChargeConfig = {
  deduct: number;
  deductDeepThink?: number;
  isTokenBased?: boolean;
  tokenFeeRatio?: number;
  usingDeepThinking?: boolean;
};

export type AgentRunSettlement = {
  agentRunId: string;
  callCount: number;
  charge: number;
  chargeType: number;
  completionTokens: number;
  model: string;
  promptTokens: number;
  settled: boolean;
  totalTokens: number;
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAgentModelProxyToken(claims: AgentModelProxyClaims, secret: string) {
  const payload = base64UrlEncode(JSON.stringify(claims));
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyAgentModelProxyToken(
  token: string,
  secret: string,
  now = Date.now(),
): AgentModelProxyClaims {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || !safeEqual(signature, signPayload(payload, secret))) {
    throw new Error('invalid agent model proxy token');
  }

  const claims = JSON.parse(base64UrlDecode(payload)) as AgentModelProxyClaims;
  if (!claims.agentRunId || !claims.userId || !claims.model || !claims.expiresAt) {
    throw new Error('invalid agent model proxy token');
  }
  if (claims.expiresAt <= now) {
    throw new Error('agent model proxy token expired');
  }

  return claims;
}

export function createEmptyAgentUsageLedger(input: {
  agentRunId: string;
  chatId?: number;
  groupId?: number;
  model: string;
  userId: number;
  usingDeepThinking?: boolean;
}): AgentUsageLedger {
  const now = Date.now();
  return {
    agentRunId: input.agentRunId,
    callCount: 0,
    chatId: input.chatId,
    completionTokens: 0,
    createdAt: now,
    groupId: input.groupId,
    model: input.model,
    promptTokens: 0,
    settled: false,
    totalTokens: 0,
    updatedAt: now,
    userId: input.userId,
    usingDeepThinking: input.usingDeepThinking === true,
  };
}

export function recordOpenAiUsage(ledger: AgentUsageLedger, usage?: OpenAiUsagePayload | null) {
  const promptTokens = Number(usage?.prompt_tokens || 0);
  const completionTokens = Number(usage?.completion_tokens || 0);
  const totalTokens = Number(usage?.total_tokens || promptTokens + completionTokens);

  ledger.callCount += 1;
  ledger.promptTokens += Number.isFinite(promptTokens) ? promptTokens : 0;
  ledger.completionTokens += Number.isFinite(completionTokens) ? completionTokens : 0;
  ledger.totalTokens += Number.isFinite(totalTokens) ? totalTokens : 0;
  ledger.updatedAt = Date.now();
  return ledger;
}

export function calculateAgentRunCharge(
  ledger: Pick<AgentUsageLedger, 'totalTokens'>,
  config: AgentRunChargeConfig,
) {
  if (Number(ledger.totalTokens || 0) <= 0) {
    return 0;
  }

  const deduct = Number(config.deduct || 0);
  const deepMultiplier =
    config.usingDeepThinking === true ? Math.max(Number(config.deductDeepThink || 1), 1) : 1;

  if (config.isTokenBased === true && Number(config.tokenFeeRatio) > 0) {
    return (
      deduct *
      Math.ceil(Number(ledger.totalTokens || 0) / Number(config.tokenFeeRatio)) *
      deepMultiplier
    );
  }

  return deduct * deepMultiplier;
}
