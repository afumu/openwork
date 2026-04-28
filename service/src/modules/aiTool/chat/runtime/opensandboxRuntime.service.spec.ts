import { OpenSandboxRuntimeService } from './opensandboxRuntime.service';

declare const afterEach: any;
declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

function createSandbox(id = 'sbx-1') {
  return {
    commands: {
      run: jest.fn().mockResolvedValue({ exitCode: 0 }),
    },
    connectionConfig: { protocol: 'http' },
    getEndpoint: jest.fn().mockResolvedValue({
      endpoint: '127.0.0.1:8787',
      headers: { 'x-open-sandbox-token': 'signed' },
    }),
    getInfo: jest.fn().mockResolvedValue({
      id,
      status: { state: 'Running' },
    }),
    id,
    renew: jest.fn().mockResolvedValue({}),
  };
}

describe('OpenSandboxRuntimeService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('creates an OpenSandbox runtime with conversation metadata and bridge endpoint', async () => {
    process.env = {
      ...originalEnv,
      OPEN_SANDBOX_DOMAIN: 'http://localhost:8080',
      OPENWORK_AGENT_RUNTIME_IMAGE: 'openwork-agent-runtime:test',
    };
    const sandbox = createSandbox('sbx-created');
    const client = {
      createSandbox: jest.fn().mockResolvedValue(sandbox),
      findSandboxByMetadata: jest.fn().mockResolvedValue(null),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    });

    const service = new OpenSandboxRuntimeService(client as any);
    const descriptor = await service.ensureRuntime({
      anthropicApiKey: 'sk-ant-test',
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'sk-ant-test',
          CLAUDE_BRIDGE_CWD: '/workspace/conversations/128',
          CLAUDE_BRIDGE_PORT: '8787',
          IS_SANDBOX: '1',
        }),
        image: 'openwork-agent-runtime:test',
        metadata: {
          groupId: '128',
          runtimeKind: 'openwork-agent',
          userId: '42',
        },
      }),
    );
    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining('/opt/openwork-agent-bridge/bridge.mjs'),
      expect.objectContaining({
        envs: expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'sk-ant-test',
          CLAUDE_BRIDGE_CWD: '/workspace/conversations/128',
          CLAUDE_BRIDGE_PORT: '8787',
        }),
        workingDirectory: '/opt/openwork-agent-bridge',
      }),
    );
    expect(descriptor).toEqual(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:8787',
        endpointHeaders: { 'x-open-sandbox-token': 'signed' },
        groupId: 128,
        mode: 'opensandbox',
        sandboxId: 'sbx-created',
        status: 'Running',
        userId: 42,
        workspaceDir: 'conversations/128',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('reuses an existing sandbox found by metadata instead of creating another one', async () => {
    process.env = {
      ...originalEnv,
      OPEN_SANDBOX_DOMAIN: 'http://localhost:8080',
      OPENWORK_AGENT_RUNTIME_IMAGE: 'openwork-agent-runtime:test',
    };
    const sandbox = createSandbox('sbx-existing');
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      createSandbox: jest.fn(),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    });

    const service = new OpenSandboxRuntimeService(client as any);
    const descriptor = await service.ensureRuntime({
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.connectSandbox).toHaveBeenCalledWith('sbx-existing');
    expect(client.createSandbox).not.toHaveBeenCalled();
    expect(sandbox.commands.run).toHaveBeenCalled();
    expect(descriptor.sandboxId).toBe('sbx-existing');
  });
});
