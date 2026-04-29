import {
  buildRuntimeMetadata,
  resolveRuntimeWorkspace,
  shouldUseOpenSandboxAgent,
} from './runtimeWorkspace';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('OpenSandbox runtime workspace helpers', () => {
  it('builds a stable conversation workspace under the configured root', () => {
    expect(resolveRuntimeWorkspace({ groupId: 128, workspaceRoot: '/workspace' })).toEqual({
      workspaceDir: '/workspace',
      workspaceRoot: '/workspace',
      workspacePath: '/workspace',
    });
  });

  it('keeps sandbox metadata scoped to one user and one conversation', () => {
    expect(buildRuntimeMetadata({ groupId: 128, userId: 42 })).toEqual({
      groupId: '128',
      runtimeKind: 'openwork-agent',
      userId: '42',
    });
  });

  it('routes normal chat models through the runtime regardless of provider format', () => {
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai', keyType: 1 }, 'gpt-4o')).toBe(true);
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'anthropic', keyType: 1 }, 'claude-3-5')).toBe(
      true,
    );
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai' }, 'claude_code')).toBe(true);
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai', keyType: 2 }, 'dall-e-3')).toBe(false);
  });
});
