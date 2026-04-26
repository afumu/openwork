export interface ArtifactFileItem {
  name: string
  path: string
  preview?: string
  size: number
  type: string
  updatedAt: string
}

export interface ArtifactWorkspaceFileItem extends ArtifactFileItem {
  runId: string | null
  source?: 'artifacts_root' | 'workspace_root' | 'workspace_loose' | string
}

export interface ArtifactWorkspaceDirectoryItem {
  children: ArtifactWorkspaceTreeItem[]
  name: string
  nodeType: 'directory'
  path: string
  updatedAt: string
}

export interface ArtifactWorkspaceTreeFileItem extends ArtifactWorkspaceFileItem {
  nodeType: 'file'
}

export type ArtifactWorkspaceTreeItem =
  | ArtifactWorkspaceDirectoryItem
  | ArtifactWorkspaceTreeFileItem

export interface ArtifactRunItem {
  runId: string
  files: ArtifactFileItem[]
  source?: 'artifacts_root' | 'workspace_root' | string
}

export interface ArtifactManifest {
  artifactsRoot?: string
  runs?: ArtifactRunItem[]
  workspaceDir?: string
  workspaceRootMode?: 'data' | 'conversation'
  workspaceFiles?: ArtifactWorkspaceFileItem[]
  workspaceTree?: ArtifactWorkspaceTreeItem[]
}

export interface ArtifactReadResult {
  content: string
  path: string
  run_id?: string | null
  size: number
  truncated: boolean
  type: string
  updatedAt: string
}

export type RuntimeWorkspaceTab = 'files' | 'preview' | 'terminal' | 'info'
export type RuntimePreviewKind = 'markdown' | 'html' | 'image' | 'code' | 'text' | 'empty'

export interface RuntimeStatusPayload {
  containerName?: string
  groupId: number
  hostPort?: number
  mode: 'docker' | 'direct'
  running?: boolean
  status?: string
  userId?: number
  volumeName?: string
}
