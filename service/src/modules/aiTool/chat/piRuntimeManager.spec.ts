import {
  buildPiRuntimeNames,
  extractPublishedPort,
  resolveDockerToolsMode,
  resolveRuntimeBundleHostPath,
  resolveConversationWorkspace,
  resolveRuntimeBootstrapAgentFiles,
} from './piRuntimeManager';

declare const describe: any;
declare const expect: any;
declare const test: any;

describe('piRuntimeManager helpers', () => {
  test('buildPiRuntimeNames uses deterministic names per user', () => {
    expect(buildPiRuntimeNames(42)).toEqual({
      containerName: 'openwork-user-42',
      volumeName: 'openwork-user-42-workspace',
    });
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
});
