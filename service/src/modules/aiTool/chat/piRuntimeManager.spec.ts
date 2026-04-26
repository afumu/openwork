import {
  buildPiRuntimeNames,
  extractPublishedPort,
  PiRuntimeManagerService,
  resolveDockerToolsMode,
  resolveRuntimeBundleHostPath,
  resolveConversationWorkspace,
  resolveRuntimeBootstrapAgentFiles,
} from './piRuntimeManager';

declare const describe: any;
declare const expect: any;
declare const jest: any;
declare const test: any;

describe('piRuntimeManager helpers', () => {
  test('buildPiRuntimeNames uses deterministic names per conversation group', () => {
    expect(buildPiRuntimeNames({ groupId: 128, userId: 42 })).toEqual({
      containerName: 'openwork-user-42-group-128',
      volumeName: 'openwork-user-42-group-128-workspace',
    });
  });

  test('buildPiRuntimeNames requires a valid conversation group id', () => {
    expect(() => buildPiRuntimeNames({ groupId: 0, userId: 42 })).toThrow(
      '非法的对话分组 ID',
    );
  });

  test('extractPublishedPort reads the published 8787/tcp mapping', () => {
    expect(
      extractPublishedPort({
        NetworkSettings: {
          Ports: {
            '8787/tcp': [{ HostIp: '127.0.0.1', HostPort: '49153' }],
          },
        },
      }),
    ).toBe(49153);
  });

  test('resolveConversationWorkspace keeps group workspaces under conversations root', () => {
    expect(resolveConversationWorkspace(128)).toBe('conversations/128');
  });

  test('resolveConversationWorkspace rejects invalid group ids', () => {
    expect(() => resolveConversationWorkspace(0)).toThrow('非法的对话分组 ID');
  });

  test('resolveRuntimeBundleHostPath falls back to user home on darwin', () => {
    expect(resolveRuntimeBundleHostPath(undefined, '/Users/apple', 'darwin')).toBe(
      '/Users/apple/.openwork/runtime-bundles',
    );
  });

  test('resolveRuntimeBundleHostPath also uses user home on linux', () => {
    expect(resolveRuntimeBundleHostPath(undefined, '/home/openwork', 'linux')).toBe(
      '/home/openwork/.openwork/runtime-bundles',
    );
  });

  test('resolveRuntimeBundleHostPath respects explicit env path', () => {
    expect(resolveRuntimeBundleHostPath('/data/runtime-bundles', '/Users/apple', 'darwin')).toBe(
      '/data/runtime-bundles',
    );
  });

  test('resolveDockerToolsMode defaults runtime containers to coding tools', () => {
    expect(resolveDockerToolsMode()).toBe('coding');
    expect(resolveDockerToolsMode('', '')).toBe('coding');
  });

  test('resolveDockerToolsMode respects explicit tool mode env values', () => {
    expect(resolveDockerToolsMode('coding', 'restricted')).toBe('coding');
    expect(resolveDockerToolsMode(undefined, 'readonly')).toBe('readonly');
  });

  test('runtime bootstrap only copies non-sensitive settings into the user container', () => {
    expect(resolveRuntimeBootstrapAgentFiles()).toEqual(['settings.json']);
    expect(resolveRuntimeBootstrapAgentFiles()).not.toContain('auth.json');
    expect(resolveRuntimeBootstrapAgentFiles()).not.toContain('models.json');
  });

  test('ensureRuntime serializes concurrent first use for the same conversation container', async () => {
    const service = new PiRuntimeManagerService({} as any) as any;
    service.dockerEnabled = true;
    service.dockerHost = '127.0.0.1';
    service.dockerRuntimeBundleMountPath = '/mnt/pi-runtime-bundles';
    const inspectResult = {
      Config: {
        Env: [
          'PI_RUNTIME_BUNDLE_DIR=/mnt/pi-runtime-bundles',
          'OPENWORK_INTERNAL_SEARCH_URL=http://host.docker.internal:9527/search',
          'OPENWORK_INTERNAL_SEARCH_TOKEN=token',
        ],
      },
      Id: 'container-1',
      Mounts: [{ Destination: '/mnt/pi-runtime-bundles' }],
      NetworkSettings: {
        Ports: {
          '8787/tcp': [{ HostIp: '127.0.0.1', HostPort: '49153' }],
        },
      },
      State: {
        Running: true,
        Status: 'running',
      },
    };
    let createFinished = false;
    let resolveCreate: () => void = () => undefined;
    const createRuntime = jest.fn(
      () =>
        new Promise<void>(resolve => {
          resolveCreate = () => {
            createFinished = true;
            resolve();
          };
        }),
    );
    service.createRuntime = createRuntime;
    service.inspectContainer = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(inspectResult)
      .mockResolvedValue(inspectResult);
    service.sanitizeRuntimeAgentSecrets = jest.fn().mockResolvedValue(undefined);
    service.waitUntilHealthy = jest.fn().mockResolvedValue(undefined);

    const first = service.ensureRuntime({ groupId: 9, userId: 1 }, 'trace-1');
    const second = service.ensureRuntime({ groupId: 9, userId: 1 }, 'trace-1');

    const earlySecondResult = await Promise.race([
      second.then(() => 'resolved'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 0)),
    ]);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(earlySecondResult).toBe('pending');
    resolveCreate();

    await expect(first).resolves.toMatchObject({
      containerName: 'openwork-user-1-group-9',
      hostPort: 49153,
    });
    await expect(second).resolves.toMatchObject({
      containerName: 'openwork-user-1-group-9',
      hostPort: 49153,
    });
  });
});
