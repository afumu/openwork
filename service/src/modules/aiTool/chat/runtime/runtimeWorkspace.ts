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
  const workspaceDir = `conversations/${encodeURIComponent(String(input.groupId))}`;

  return {
    workspaceDir,
    workspaceRoot,
    workspacePath: `${workspaceRoot}/${workspaceDir}`,
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
  const apiFormat = String(modelConfig?.apiFormat || '')
    .trim()
    .toLowerCase();
  const model = String(requestedModel || modelConfig?.model || '')
    .trim()
    .toLowerCase();

  return apiFormat === 'opensandbox' || OPEN_SANDBOX_AGENT_MODELS.has(model);
}
