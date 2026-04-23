import { createAgentModelProxyToken } from './agentModelProxy';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;
declare const beforeEach: any;
declare const afterEach: any;

jest.mock(
  '@/common/utils/correctApiBaseUrl',
  () => ({
    correctApiBaseUrl: jest.fn(async (url: string) => url),
  }),
  { virtual: true },
);
jest.mock('../../globalConfig/globalConfig.service', () => ({ GlobalConfigService: class {} }));
jest.mock('../../models/models.service', () => ({ ModelsService: class {} }));
jest.mock('../../redisCache/redisCache.service', () => ({ RedisCacheService: class {} }));
jest.mock('../../userBalance/userBalance.service', () => ({ UserBalanceService: class {} }));

const { AgentModelProxyService } = require('./agentModelProxy.service');

const JWT_SECRET = 'jwt-secret';

function createService(modelOverrides: Record<string, any> = {}) {
  const globalConfigService = {
    getConfigs: jest.fn().mockResolvedValue({
      openaiBaseKey: 'sk-default',
      openaiBaseUrl: 'http://fallback.example/v1',
    }),
  };
  const modelsService = {
    getCurrentModelKeyInfo: jest.fn().mockResolvedValue({
      apiFormat: 'openai',
      deduct: 1,
      deductType: 1,
      id: 7,
      isTokenBased: true,
      key: 'sk-model',
      maxModelTokens: 64000,
      max_tokens: 4096,
      model: 'real-model',
      proxyUrl: 'http://model.example/v1',
      tokenFeeRatio: 1000,
      ...modelOverrides,
    }),
    saveUseLog: jest.fn(),
  };
  const redisCacheService = {
    get: jest.fn().mockResolvedValue(null),
    getJwtSecret: jest.fn().mockResolvedValue(JWT_SECRET),
    set: jest.fn(),
  };
  const userBalanceService = {
    deductFromBalance: jest.fn(),
  };

  return new AgentModelProxyService(
    globalConfigService as any,
    modelsService as any,
    redisCacheService as any,
    userBalanceService as any,
  );
}

function createToken() {
  return createAgentModelProxyToken(
    {
      agentRunId: 'agent_run_123',
      expiresAt: Date.now() + 60_000,
      model: 'gpt-5.3-codex',
      traceId: 'trace-123',
      userId: 1,
    },
    JWT_SECRET,
  );
}

function createRes() {
  const res: any = {
    end: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
    write: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('AgentModelProxyService upstream retry', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
      callback();
      return 0 as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries retryable empty-body upstream failures before streaming a successful response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\\n\\n',
          {
            headers: { 'content-type': 'text/event-stream' },
            status: 200,
          },
        ),
      );
    const service = createService();
    const res = createRes();

    await service.proxyChatCompletions(
      createToken(),
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'gpt-5.3-codex',
        stream: true,
      },
      res,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('passes backend model token limits to the request-scoped PI model proxy', async () => {
    const service = createService();

    const run = await service.createRun({
      model: 'gpt-5.3-codex',
      proxyBaseUrl: 'http://127.0.0.1:9520/api/openwork/internal/model-proxy/v1',
      userId: 1,
    });

    expect(run.modelProxy).toMatchObject({
      contextWindow: 64000,
      maxTokens: 4096,
      model: 'gpt-5.3-codex',
    });
  });

  it('does not retry non-retryable upstream failures', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));
    const service = createService();
    const res = createRes();

    await service.proxyChatCompletions(
      createToken(),
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'gpt-5.3-codex',
        stream: true,
      },
      res,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'upstream_model_error',
          message: expect.stringContaining('HTTP 400'),
        }),
      }),
    );
  });

  it('converts OpenAI-compatible requests to Anthropic Messages format when configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ text: 'hello from anthropic', type: 'text' }],
          id: 'msg_1',
          model: 'claude-3-5-sonnet',
          role: 'assistant',
          stop_reason: 'end_turn',
          type: 'message',
          usage: {
            input_tokens: 12,
            output_tokens: 5,
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    const service = createService({
      apiFormat: 'anthropic',
      model: 'claude-3-5-sonnet',
      proxyUrl: 'http://anthropic.example/v1',
    });
    const res = createRes();

    await service.proxyChatCompletions(
      createToken(),
      {
        messages: [
          { content: 'System rules', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: 'gpt-5.3-codex',
        stream: false,
      },
      res,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://anthropic.example/v1/messages',
      expect.objectContaining({
        body: JSON.stringify({
          max_tokens: 4096,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-5-sonnet',
          stream: false,
          system: 'System rules',
        }),
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': 'sk-model',
        }),
        method: 'POST',
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          expect.objectContaining({
            finish_reason: 'stop',
            message: { content: 'hello from anthropic', role: 'assistant' },
          }),
        ],
        usage: {
          completion_tokens: 5,
          prompt_tokens: 12,
          total_tokens: 17,
        },
      }),
    );
  });
});
