import type { ToolExecutionStreamItem } from '../../../chat/chatStreamSegments';

export type RuntimeDescriptor = {
  mode: 'opensandbox';
  sandboxId: string;
  baseUrl: string;
  endpointHeaders?: Record<string, string>;
  groupId: number | string;
  userId: number;
  workspaceRoot: string;
  workspaceDir: string;
  status?: string;
};

export type RuntimeTerminalTarget = {
  mode: 'opensandbox';
  sandboxId: string;
  execdBaseUrl: string;
  endpointHeaders?: Record<string, string>;
  groupId: number | string;
  shell: string;
  userId: number;
  workspacePath: string;
};

export type RuntimeWorkspace = {
  workspaceRoot: string;
  workspaceDir: string;
  workspacePath: string;
};

export type RuntimeWorkspaceFileItem = {
  name: string;
  path: string;
  preview?: string;
  size: number;
  type: string;
  updatedAt: string;
  runId: string | null;
  source: 'workspace_root';
};

export type RuntimeWorkspaceManifest = {
  workspaceDir: string;
  workspaceRoot: string;
  workspaceRootMode: 'conversation';
  workspaceFiles: RuntimeWorkspaceFileItem[];
  truncated?: boolean;
};

export type RuntimeWorkspaceReadResult = {
  content: string;
  path: string;
  run_id: string | null;
  size: number;
  truncated: boolean;
  type: string;
  updatedAt: string;
};

export type OpenSandboxRuntimeConfig = {
  apiKey?: string;
  bridgePort: number;
  domain: string;
  execdPort: number;
  image: string;
  timeoutSeconds: number;
  useServerProxy: boolean;
  workspaceBackend: 'container' | 'volume';
  workspaceRoot: string;
  workspaceVolumeDeleteOnSandboxTermination: boolean;
  workspaceVolumePrefix: string;
  workspaceVolumeSize: string;
  workspaceVolumeStorageClass?: string;
  cpu?: string;
  memory?: string;
};

export type EnsureRuntimeInput = {
  apiBaseUrl?: string;
  apiFormat?: string;
  apiKey?: string;
  groupId: number | string;
  model?: string;
  traceId?: string;
  userId: number;
};

export type RuntimeStatusInput = {
  groupId: number | string;
  traceId?: string;
  userId: number;
};

export type AgentChatProgress = {
  content?: { type: 'text'; text: string }[];
  reasoning_content?: { type: 'text'; text: string }[];
  tool_execution_delta?: ToolExecutionStreamItem;
};

export type BridgeAgent = 'claude_code' | 'codex' | string;

export type BridgeEvent = Record<string, any> & {
  id?: number | string;
  type?: string;
};

export type OpenSandboxClientCreateInput = {
  env: Record<string, string>;
  image: string;
  metadata: Record<string, string>;
  resource?: Record<string, string>;
  timeoutSeconds: number;
  volumes?: OpenSandboxVolume[];
};

export type OpenSandboxVolumePVC = Record<string, unknown> & {
  claimName: string;
  createIfNotExists?: boolean;
  deleteOnSandboxTermination?: boolean;
  storage?: string | null;
  storageClass?: string | null;
};

export type OpenSandboxVolume = Record<string, unknown> & {
  mountPath: string;
  name: string;
  pvc?: OpenSandboxVolumePVC;
  readOnly?: boolean;
};

export type OpenSandboxEndpoint = {
  endpoint: string;
  headers?: Record<string, string>;
};

export type OpenSandboxSandbox = {
  id: string;
  commands?: {
    run(
      command: string,
      opts?: {
        background?: boolean;
        envs?: Record<string, string>;
        timeoutSeconds?: number;
        workingDirectory?: string;
      },
    ): Promise<{
      error?: string;
      exitCode?: number;
      logs?: {
        stderr?: any[] | string;
        stdout?: any[] | string;
      };
      result?: any[];
    }>;
  };
  connectionConfig?: { protocol?: string };
  getEndpoint(port: number): Promise<OpenSandboxEndpoint>;
  getInfo(): Promise<{ status?: { state?: string } } & Record<string, any>>;
  renew?(timeoutSeconds: number): Promise<any>;
  close?(): Promise<void>;
};

export type OpenSandboxClient = {
  connectSandbox(sandboxId: string): Promise<OpenSandboxSandbox>;
  createSandbox(input: OpenSandboxClientCreateInput): Promise<OpenSandboxSandbox>;
  findSandboxByMetadata(metadata: Record<string, string>): Promise<{ id: string } | null>;
};
