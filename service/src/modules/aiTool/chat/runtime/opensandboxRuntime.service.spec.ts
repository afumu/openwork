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
      apiBaseUrl: 'https://anthropic.example.com',
      apiFormat: 'anthropic',
      apiKey: 'sk-ant-test',
      groupId: 128,
      model: 'claude-test',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'sk-ant-test',
          ANTHROPIC_BASE_URL: 'https://anthropic.example.com',
          ANTHROPIC_MODEL: 'claude-test',
          CLAUDE_BRIDGE_CWD: '/workspace',
          CLAUDE_BRIDGE_PORT: '8787',
          IS_SANDBOX: '1',
          OPENWORK_MODEL_API_FORMAT: 'anthropic',
          OPENWORK_MODEL_API_KEY: 'sk-ant-test',
          OPENWORK_MODEL_BASE_URL: 'https://anthropic.example.com',
          OPENWORK_MODEL_NAME: 'claude-test',
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
          ANTHROPIC_BASE_URL: 'https://anthropic.example.com',
          ANTHROPIC_MODEL: 'claude-test',
          CLAUDE_BRIDGE_CWD: '/workspace',
          CLAUDE_BRIDGE_PORT: '8787',
          OPENWORK_MODEL_API_FORMAT: 'anthropic',
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
        workspaceDir: '/workspace',
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

  it('returns an execd PTY terminal target for an existing runtime without starting the bridge', async () => {
    process.env = {
      ...originalEnv,
      OPEN_SANDBOX_DOMAIN: 'http://localhost:8080',
      OPENWORK_AGENT_RUNTIME_IMAGE: 'openwork-agent-runtime:test',
      OPENWORK_SANDBOX_EXECD_PORT: '44772',
    };
    const sandbox = createSandbox('sbx-existing');
    sandbox.getEndpoint.mockImplementation(async (port: number) => {
      if (port === 44772) {
        return {
          endpoint: '127.0.0.1:44772',
          headers: { 'x-open-sandbox-token': 'execd-signed' },
        };
      }
      return {
        endpoint: '127.0.0.1:8787',
        headers: { 'x-open-sandbox-token': 'bridge-signed' },
      };
    });
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      createSandbox: jest.fn(),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };

    const service = new OpenSandboxRuntimeService(client as any);
    const target = await service.getRuntimeTerminalTarget({
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.connectSandbox).toHaveBeenCalledWith('sbx-existing');
    expect(client.createSandbox).not.toHaveBeenCalled();
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(sandbox.getEndpoint).toHaveBeenCalledWith(44772);
    expect(target).toEqual({
      endpointHeaders: { 'x-open-sandbox-token': 'execd-signed' },
      execdBaseUrl: 'http://127.0.0.1:44772',
      groupId: 128,
      mode: 'opensandbox',
      sandboxId: 'sbx-existing',
      shell: '/bin/bash',
      userId: 42,
      workspacePath: '/workspace',
    });
  });

  it('passes OpenAI-compatible model config without reading Anthropic env fallbacks', async () => {
    process.env = {
      ...originalEnv,
      ANTHROPIC_AUTH_TOKEN: 'env-ant-token',
      ANTHROPIC_MODEL: 'env-ant-model',
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
    await service.ensureRuntime({
      apiBaseUrl: 'https://openai.example.com/v1',
      apiFormat: 'openai',
      apiKey: 'sk-openai-test',
      groupId: 128,
      model: 'gpt-test',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          OPENAI_API_KEY: 'sk-openai-test',
          OPENAI_BASE_URL: 'https://openai.example.com/v1',
          OPENAI_MODEL: 'gpt-test',
          OPENWORK_MODEL_API_FORMAT: 'openai',
          OPENWORK_MODEL_API_KEY: 'sk-openai-test',
          OPENWORK_MODEL_BASE_URL: 'https://openai.example.com/v1',
          OPENWORK_MODEL_NAME: 'gpt-test',
        }),
      }),
    );
    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.not.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'env-ant-token',
          ANTHROPIC_MODEL: 'env-ant-model',
        }),
      }),
    );
  });

  it('lists files from the existing OpenSandbox workspace', async () => {
    process.env = {
      ...originalEnv,
      OPEN_SANDBOX_DOMAIN: 'http://localhost:8080',
      OPENWORK_AGENT_RUNTIME_IMAGE: 'openwork-agent-runtime:test',
    };
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"workspaceFiles":[{"name":"README.md","path":"README.md","size":12,"type":"markdown","updatedAt":"2026-04-29T00:00:00.000Z","runId":null,"source":"workspace_root"}]}',
            timestamp: 1777380000000,
          },
        ],
      },
    });
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };

    const service = new OpenSandboxRuntimeService(client as any);
    const manifest = await service.listWorkspaceFiles({
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.connectSandbox).toHaveBeenCalledWith('sbx-existing');
    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining("'/workspace'"),
      expect.objectContaining({
        workingDirectory: '/',
      }),
    );
    expect(manifest).toEqual({
      truncated: false,
      workspaceDir: '/workspace',
      workspaceFiles: [
        {
          name: 'README.md',
          path: 'README.md',
          runId: null,
          size: 12,
          source: 'workspace_root',
          type: 'markdown',
          updatedAt: '2026-04-29T00:00:00.000Z',
        },
      ],
      workspaceRoot: '/workspace',
      workspaceRootMode: 'conversation',
    });
  });

  it('reads a file from the existing OpenSandbox workspace', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: { stdout: [] },
      result: [
        {
          text: 'OPENWORK_WORKSPACE_JSON:{"content":"hello","path":"README.md","run_id":null,"size":5,"truncated":false,"type":"markdown","updatedAt":"2026-04-29T00:00:00.000Z"}',
          timestamp: 1777380000000,
        },
      ],
    });
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };

    const service = new OpenSandboxRuntimeService(client as any);
    const file = await service.readWorkspaceFile({
      groupId: 128,
      path: '/workspace/README.md',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining("'README.md'"),
      expect.objectContaining({
        workingDirectory: '/',
      }),
    );
    expect(file).toEqual({
      content: 'hello',
      path: 'README.md',
      run_id: null,
      size: 5,
      truncated: false,
      type: 'markdown',
      updatedAt: '2026-04-29T00:00:00.000Z',
    });
  });
});
