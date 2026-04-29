import { OpenSandboxAgentChatService } from './opensandboxAgentChat.service';

declare const afterEach: any;
declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

function sseBody(event: Record<string, any>) {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    },
  };
}

describe('OpenSandboxAgentChatService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('treats bridge run_completed as a normal stream stop instead of aborting the fetch', async () => {
    const runtimeService = {
      ensureRuntime: jest.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:8787',
        endpointHeaders: {},
        groupId: 23,
        mode: 'opensandbox',
        sandboxId: 'sbx-1',
        userId: 1,
        workspaceDir: '/workspace',
        workspaceRoot: '/workspace',
      }),
      stopAgent: jest.fn(),
    };
    global.fetch = jest.fn((url: string, init?: any) => {
      const target = String(url);
      if (target.endsWith('/health')) {
        return Promise.resolve({
          json: async () => ({ ok: true, next_event_id: 1 }),
          ok: true,
        } as any);
      }
      if (target.includes('/events')) {
        return Promise.resolve({
          body: sseBody({
            result: '完成',
            type: 'run_completed',
          }),
          ok: true,
        } as any);
      }
      if (target.endsWith('/message')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({ ok: true } as any);
      }
      return Promise.reject(new Error(`unexpected fetch ${target}`));
    }) as any;

    const service = new OpenSandboxAgentChatService(runtimeService as any);
    const response = await service.chat({
      abortController: new AbortController(),
      chatId: 78,
      groupId: 23,
      model: 'deepseek-v4-flash',
      prompt: '你好',
      userId: 1,
    });

    expect(response.finishReason).toBe('stop');
    expect(response.errMsg).toBeUndefined();
    expect(response.full_content).toBe('完成');
    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
  });
});
