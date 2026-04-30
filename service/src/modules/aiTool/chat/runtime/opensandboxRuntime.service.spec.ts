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

function expectValidOpenSandboxMetadata(metadata: Record<string, string>) {
  for (const value of Object.values(metadata)) {
    expect(value).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/);
  }
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
        metadata: expect.objectContaining({
          groupId: '128',
          runtimeKind: 'openwork-agent',
          userId: '42',
          workspaceBackend: 'volume',
          workspaceRoot: 'workspace',
          workspaceScope: 'conversation',
          workspaceVolumeName: expect.stringMatching(/^openwork-ws-u42-g128-[a-f0-9]{8}$/),
        }),
        volumes: [
          {
            mountPath: '/workspace',
            name: 'workspace',
            pvc: expect.objectContaining({
              claimName: expect.stringMatching(/^openwork-ws-u42-g128-[a-f0-9]{8}$/),
              createIfNotExists: true,
              deleteOnSandboxTermination: false,
              storage: '5Gi',
            }),
            readOnly: false,
          },
        ],
      }),
    );
    expectValidOpenSandboxMetadata(client.createSandbox.mock.calls[0][0].metadata);
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

  it('can disable persistent workspace volume mounting for container-only workspaces', async () => {
    process.env = {
      ...originalEnv,
      OPEN_SANDBOX_DOMAIN: 'http://localhost:8080',
      OPENWORK_AGENT_RUNTIME_IMAGE: 'openwork-agent-runtime:test',
      OPENWORK_WORKSPACE_BACKEND: 'container',
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
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(client.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workspaceBackend: 'container',
          workspaceRoot: 'workspace',
          workspaceScope: 'conversation',
        }),
      }),
    );
    expectValidOpenSandboxMetadata(client.createSandbox.mock.calls[0][0].metadata);
    expect(client.createSandbox.mock.calls[0][0].volumes).toBeUndefined();
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
      path: 'README.md',
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

  it('writes a UTF-8 file in the existing OpenSandbox workspace', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"kind":"file","name":"App.tsx","path":"src/App.tsx","size":11,"type":"typescript","updatedAt":"2026-04-29T00:00:00.000Z","runId":null,"source":"workspace_root"}',
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
    const entry = await service.writeWorkspaceFile({
      content: 'hello world',
      groupId: 128,
      path: 'src/App.tsx',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining("'src/App.tsx'"),
      expect.objectContaining({ workingDirectory: '/' }),
    );
    expect(sandbox.commands.run.mock.calls[0][0]).toContain('assertWritableTargetInsideRoot');
    expect(entry).toEqual(
      expect.objectContaining({ kind: 'file', path: 'src/App.tsx', size: 11, type: 'typescript' }),
    );
  });

  it('creates a directory in the existing OpenSandbox workspace', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"kind":"directory","name":"components","path":"src/components","size":64,"type":"directory","updatedAt":"2026-04-29T00:00:00.000Z","runId":null,"source":"workspace_root"}',
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
    const entry = await service.createWorkspaceEntry({
      groupId: 128,
      kind: 'directory',
      path: 'src/components',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining("'directory'"),
      expect.objectContaining({ workingDirectory: '/' }),
    );
    expect(sandbox.commands.run.mock.calls[0][0]).toContain('assertWritableTargetInsideRoot');
    expect(entry).toEqual(expect.objectContaining({ kind: 'directory', path: 'src/components' }));
  });

  it('renames a workspace entry', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"fromPath":"old.ts","toPath":"new.ts","entry":{"kind":"file","name":"new.ts","path":"new.ts","size":4,"type":"typescript","updatedAt":"2026-04-29T00:00:00.000Z","runId":null,"source":"workspace_root"}}',
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
    const result = await service.renameWorkspaceEntry({
      fromPath: 'old.ts',
      groupId: 128,
      toPath: 'new.ts',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run.mock.calls[0][0]).toContain('assertWritableTargetInsideRoot');
    expect(result).toEqual(expect.objectContaining({ fromPath: 'old.ts', toPath: 'new.ts' }));
  });

  it('deletes a workspace entry', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"deleted":true,"path":"old.ts","kind":"file","type":"typescript","size":4,"updatedAt":"2026-04-29T00:00:00.000Z"}',
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
    const result = await service.deleteWorkspaceEntry({
      groupId: 128,
      path: 'old.ts',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(result).toEqual(expect.objectContaining({ deleted: true, path: 'old.ts' }));
  });

  it('rejects traversal and hidden OpenWork runtime paths before running workspace commands', async () => {
    const sandbox = createSandbox('sbx-existing');
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };
    const service = new OpenSandboxRuntimeService(client as any);

    await expect(
      service.writeWorkspaceFile({
        content: 'oops',
        groupId: 128,
        path: '../escape.txt',
        traceId: 'trace-1',
        userId: 42,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.readWorkspaceFile({
        groupId: 128,
        path: '.openwork/claude-session.json',
        traceId: 'trace-1',
        userId: 42,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(sandbox.commands.run).not.toHaveBeenCalled();
  });

  it('rejects oversized workspace write payloads before running commands', async () => {
    const sandbox = createSandbox('sbx-existing');
    const client = {
      connectSandbox: jest.fn().mockResolvedValue(sandbox),
      findSandboxByMetadata: jest.fn().mockResolvedValue({ id: 'sbx-existing' }),
    };
    const service = new OpenSandboxRuntimeService(client as any);

    await expect(
      service.writeWorkspaceFile({
        content: 'x'.repeat(2 * 1024 * 1024 + 1),
        groupId: 128,
        path: 'big.txt',
        traceId: 'trace-1',
        userId: 42,
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(sandbox.commands.run).not.toHaveBeenCalled();
  });

  it('returns null for workspace mutations when runtime is missing', async () => {
    const client = {
      connectSandbox: jest.fn(),
      findSandboxByMetadata: jest.fn().mockResolvedValue(null),
    };
    const service = new OpenSandboxRuntimeService(client as any);

    await expect(
      service.writeWorkspaceFile({
        content: 'hello',
        groupId: 128,
        path: 'README.md',
        traceId: 'trace-1',
        userId: 42,
      }),
    ).resolves.toBeNull();
    expect(client.connectSandbox).not.toHaveBeenCalled();
  });

  it('searches workspace content with bounded results', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"results":[{"path":"src/App.tsx","matches":[{"line":1,"column":8,"preview":"export function App() {}"}]}],"truncated":true}',
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
    const result = await service.searchWorkspace({
      groupId: 128,
      query: 'function',
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining("'1000'"),
      expect.objectContaining({ timeoutSeconds: 20, workingDirectory: '/' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        results: [
          {
            matches: [{ column: 8, line: 1, preview: 'export function App() {}' }],
            path: 'src/App.tsx',
          },
        ],
        truncated: true,
      }),
    );
  });

  it('reads OpenWork project status from the existing workspace', async () => {
    const sandbox = createSandbox('sbx-existing');
    sandbox.commands.run.mockResolvedValueOnce({
      exitCode: 0,
      logs: {
        stdout: [
          {
            text: 'OPENWORK_WORKSPACE_JSON:{"ok":true,"name":"todo-app","template":"vite-react","workspace":"/workspace","devPort":9000,"runtime":{"dev":{"running":true,"port":9000,"pid":123}}}',
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
    const status = await service.getOpenWorkProjectStatus({
      groupId: 128,
      traceId: 'trace-1',
      userId: 42,
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      expect.stringContaining('openwork'),
      expect.objectContaining({
        workingDirectory: '/',
      }),
    );
    expect(status).toEqual({
      devPort: 9000,
      name: 'todo-app',
      ok: true,
      runtime: {
        dev: {
          pid: 123,
          port: 9000,
          running: true,
        },
      },
      template: 'vite-react',
      workspace: '/workspace',
    });
  });
});
