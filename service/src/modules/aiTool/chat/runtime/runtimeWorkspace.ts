import type { RuntimeWorkspace } from './opensandboxRuntime.types';

const OPEN_SANDBOX_AGENT_MODELS = new Set([
  'claude_code',
  'claude-code',
  'opensandbox-claude-code',
]);

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '');
}

export function resolveRuntimeWorkspace(input: {
  groupId: number | string;
  workspaceRoot?: string;
}): RuntimeWorkspace {
  const workspaceRoot = `/${trimSlashes(input.workspaceRoot || '/workspace')}`;

  return {
    workspaceDir: workspaceRoot,
    workspaceRoot,
    workspacePath: workspaceRoot,
  };
}

export function buildRuntimeMetadata(input: { groupId: number | string; userId: number }) {
  return {
    groupId: String(input.groupId),
    runtimeKind: 'openwork-agent',
    userId: String(input.userId),
  };
}

export function shouldUseOpenSandboxAgent(modelConfig: any, requestedModel?: string) {
  const keyType = Number(modelConfig?.keyType ?? 1);
  const model = String(requestedModel || modelConfig?.model || '')
    .trim()
    .toLowerCase();

  return keyType === 1 || OPEN_SANDBOX_AGENT_MODELS.has(model);
}
