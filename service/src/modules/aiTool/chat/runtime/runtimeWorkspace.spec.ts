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

  it('routes only project groups through the OpenSandbox agent', () => {
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai', keyType: 1 }, 'gpt-4o', 'chat')).toBe(
      false,
    );
    expect(
      shouldUseOpenSandboxAgent({ apiFormat: 'anthropic', keyType: 1 }, 'claude-3-5', 'chat'),
    ).toBe(false);
    expect(
      shouldUseOpenSandboxAgent({ apiFormat: 'openai', keyType: 1 }, 'gpt-4o', 'project'),
    ).toBe(true);
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai' }, 'claude_code', 'project')).toBe(true);
    expect(
      shouldUseOpenSandboxAgent({ apiFormat: 'openai', keyType: 2 }, 'dall-e-3', 'project'),
    ).toBe(false);
  });
});
