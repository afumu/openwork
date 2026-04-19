import {
  calculateAgentRunCharge,
  createAgentModelProxyToken,
  createEmptyAgentUsageLedger,
  recordOpenAiUsage,
  verifyAgentModelProxyToken,
} from './agentModelProxy';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('agent model proxy token', () => {
  it('round-trips signed run claims without exposing provider keys', () => {
    const token = createAgentModelProxyToken(
      {
        agentRunId: 'run_123',
        expiresAt: 1893456000000,
        groupId: 88,
        model: 'gpt-5.2',
        userId: 42,
      },
      'jwt-secret',
    );

    const claims = verifyAgentModelProxyToken(token, 'jwt-secret', 1893455000000);

    expect(claims).toMatchObject({
      agentRunId: 'run_123',
      groupId: 88,
      model: 'gpt-5.2',
      userId: 42,
    });
    expect(token).not.toContain('sk-');
  });

  it('rejects expired or tampered tokens', () => {
    const token = createAgentModelProxyToken(
      {
        agentRunId: 'run_123',
        expiresAt: 1893456000000,
        model: 'gpt-5.2',
        userId: 42,
      },
      'jwt-secret',
    );

    expect(() => verifyAgentModelProxyToken(`${token}x`, 'jwt-secret', 1893455000000)).toThrow(
      'invalid agent model proxy token',
    );
    expect(() => verifyAgentModelProxyToken(token, 'jwt-secret', 1893457000000)).toThrow(
      'agent model proxy token expired',
    );
  });
});

describe('agent model usage ledger', () => {
  it('aggregates token usage before applying token billing ratio', () => {
    const ledger = createEmptyAgentUsageLedger({
      agentRunId: 'run_123',
      model: 'gpt-5.2',
      userId: 42,
    });

    recordOpenAiUsage(ledger, {
      prompt_tokens: 700,
      completion_tokens: 300,
      total_tokens: 1000,
    });
    recordOpenAiUsage(ledger, {
      prompt_tokens: 400,
      completion_tokens: 100,
      total_tokens: 500,
    });

    const charge = calculateAgentRunCharge(ledger, {
      deduct: 2,
      deductDeepThink: 3,
      isTokenBased: true,
      tokenFeeRatio: 1000,
      usingDeepThinking: true,
    });

    expect(ledger.callCount).toBe(2);
    expect(ledger.promptTokens).toBe(1100);
    expect(ledger.completionTokens).toBe(400);
    expect(ledger.totalTokens).toBe(1500);
    expect(charge).toBe(12);
  });

  it('charges fixed-price models once per agent run instead of once per inner call', () => {
    const ledger = createEmptyAgentUsageLedger({
      agentRunId: 'run_123',
      model: 'gpt-4o',
      userId: 42,
    });

    recordOpenAiUsage(ledger, {
      prompt_tokens: 100,
      completion_tokens: 100,
      total_tokens: 200,
    });
    recordOpenAiUsage(ledger, {
      prompt_tokens: 100,
      completion_tokens: 100,
      total_tokens: 200,
    });

    expect(
      calculateAgentRunCharge(ledger, {
        deduct: 5,
        deductDeepThink: 4,
        isTokenBased: false,
        tokenFeeRatio: 0,
        usingDeepThinking: true,
      }),
    ).toBe(20);
  });

  it('does not charge fixed-price models when no upstream usage was recorded', () => {
    const ledger = createEmptyAgentUsageLedger({
      agentRunId: 'run_123',
      model: 'gpt-4o',
      userId: 42,
    });

    expect(
      calculateAgentRunCharge(ledger, {
        deduct: 5,
        isTokenBased: false,
      }),
    ).toBe(0);
  });
});
