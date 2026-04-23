import { OpenAIChatService } from './chat.service';
import { normalizeArtifactReadPath } from './artifactPath';

declare const describe: any;
declare const expect: any;
declare const jest: any;
declare const test: any;

function createOpenAIChatService() {
  return new OpenAIChatService(
    { getConfigs: jest.fn() } as any,
    {} as any,
    {
      getDirectGatewayBaseUrl: jest.fn(),
      isDockerEnabled: jest.fn().mockReturnValue(false),
      resolveInternalModelProxyBaseUrl: jest.fn(),
    } as any,
    {
      settleRun: jest.fn().mockResolvedValue(null),
    } as any,
  );
}

describe('openAI chat artifact path normalization', () => {
  test('strips duplicated data/runId prefix when runId is provided', () => {
    expect(
      normalizeArtifactReadPath(
        'data/20260414_131408_us-iran-war-capital-markets/00_index.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('00_index.md');
  });

  test('strips duplicated runId prefix without data segment when runId is provided', () => {
    expect(
      normalizeArtifactReadPath(
        '20260414_131408_us-iran-war-capital-markets/07_psc.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('07_psc.md');
  });

  test('keeps workspace-relative paths unchanged when they are already normalized', () => {
    expect(
      normalizeArtifactReadPath(
        'data/shared-summary.md',
        '20260414_131408_us-iran-war-capital-markets',
      ),
    ).toBe('data/shared-summary.md');
  });

  test('keeps original path when runId is missing', () => {
    expect(
      normalizeArtifactReadPath(
        'data/20260414_131408_us-iran-war-capital-markets/00_index.md',
        undefined,
      ),
    ).toBe('data/20260414_131408_us-iran-war-capital-markets/00_index.md');
  });
});

describe('OpenAIChatService finish reason handling', () => {
  test('preserves length finish reason returned by the PI gateway', async () => {
    const service = createOpenAIChatService();
    jest.spyOn(service as any, 'handleDeepThinking').mockResolvedValue(false);
    jest
      .spyOn(service as any, 'handlePiGatewayChat')
      .mockImplementation(async (_messagesHistory: any, _inputs: any, result: any) => {
        result.agentRunId = 'agent-run-1';
        result.finishReason = 'length';
        result.full_content = 'partial content before truncation';
      });

    const result = await service.chat([{ role: 'user', content: '继续执行。' }], {
      abortController: new AbortController(),
      apiKey: 'sk-test',
      chatId: 1,
      isFileUpload: 0,
      max_tokens: 4096,
      model: 'openwork-service-proxy/claude',
      modelName: 'Claude',
      proxyUrl: 'http://proxy.example',
      temperature: 0.3,
      timeout: 30_000,
    });

    expect(result.finishReason).toBe('length');
    expect(result.full_content).toBe('partial content before truncation');
  });
});
