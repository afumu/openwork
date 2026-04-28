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
      workspaceDir: 'conversations/128',
      workspaceRoot: '/workspace',
      workspacePath: '/workspace/conversations/128',
    });
  });

  it('keeps sandbox metadata scoped to one user and one conversation', () => {
    expect(buildRuntimeMetadata({ groupId: 128, userId: 42 })).toEqual({
      groupId: '128',
      runtimeKind: 'openwork-agent',
      userId: '42',
    });
  });

  it('routes only explicit OpenSandbox agent models through the runtime', () => {
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'opensandbox' }, 'gpt-4o')).toBe(true);
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai' }, 'claude_code')).toBe(true);
    expect(shouldUseOpenSandboxAgent({ apiFormat: 'openai' }, 'gpt-4o')).toBe(false);
  });
});
