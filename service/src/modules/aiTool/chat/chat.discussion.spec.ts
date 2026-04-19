declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

jest.mock(
  '@/common/utils',
  () => ({
    handleError: jest.fn(),
  }),
  { virtual: true },
);

jest.mock(
  '@/common/utils/chatTrace',
  () => ({
    serializeErrorForLog: (error: unknown) =>
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    shouldLogProgressHeartbeat: jest.fn().mockReturnValue(false),
  }),
  { virtual: true },
);

jest.mock(
  '@/common/utils/correctApiBaseUrl',
  () => ({
    correctApiBaseUrl: jest.fn(async (value: string) => value),
  }),
  { virtual: true },
);

jest.mock('../../globalConfig/globalConfig.service', () => ({
  GlobalConfigService: class GlobalConfigService {},
}));

jest.mock('../search/netSearch.service', () => ({
  NetSearchService: class NetSearchService {},
}));

jest.mock('./piRuntimeManager', () => ({
  PiRuntimeManagerService: class PiRuntimeManagerService {},
  resolveConversationWorkspace: (groupId: number) => `conversations/${groupId}`,
}));

jest.mock('./agentModelProxy.service', () => ({
  AgentModelProxyService: class AgentModelProxyService {},
}));

import { OpenAIChatService } from './chat.service';

describe('OpenAIChatService discussion runtime requests', () => {
  it('uses model_proxy for discussion requests and settles the agent run afterwards', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ ok: true }),
            },
          },
        ],
      }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    const service = new OpenAIChatService(
      {
        getConfigs: jest.fn().mockResolvedValue('gpt-5.3-codex'),
      } as any,
      {
        getWebSearchCapabilityProfile: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        getDirectGatewayBaseUrl: jest.fn().mockReturnValue('http://127.0.0.1:8787'),
        isDockerEnabled: jest.fn().mockReturnValue(false),
        resolveInternalModelProxyBaseUrl: jest
          .fn()
          .mockReturnValue('http://127.0.0.1:9520/api/openwork/internal/model-proxy/v1'),
      } as any,
      {
        createRun: jest.fn().mockResolvedValue({
          agentRunId: 'agent_run_123',
          modelProxy: {
            apiKey: 'proxy-token',
            baseUrl: 'http://127.0.0.1:9520/api/openwork/internal/model-proxy/v1',
            model: 'gpt-5.3-codex',
          },
        }),
        settleRun: jest.fn().mockResolvedValue({
          agentRunId: 'agent_run_123',
          settled: true,
        }),
      } as any,
    );

    const result = await service.requestPiDiscussion({
      action: 'discover_experts',
      payload: { topic: 'AI infra' },
      sessionId: 'discussion-1',
      traceId: 'trace-1',
      userId: 7,
      workspaceDir: 'conversations/discussion-1',
    });

    expect(result).toEqual({ ok: true });
    expect(service['agentModelProxyService'].createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.3-codex',
        userId: 7,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model_proxy"'),
      }),
    );
    expect(service['agentModelProxyService'].settleRun).toHaveBeenCalledWith('agent_run_123');

    global.fetch = originalFetch;
  });
});
