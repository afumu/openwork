import { resolvePreviewKind } from './artifactWorkspace'
import type { ArtifactReadResult, RuntimeStatusPayload } from './types'

export type WorkspaceOpenTarget =
  | {
      content: string
      filename: string
      kind: 'blob'
      mimeType: string
    }
  | {
      kind: 'url'
      url: string
    }

export function resolveWorkspaceToolbarCopyText(file: ArtifactReadResult | null) {
  return file?.content || ''
}

export function resolveWorkspaceOpenTarget(file: ArtifactReadResult | null): WorkspaceOpenTarget | null {
  if (!file) return null

  const previewKind = resolvePreviewKind(file.path, file.type)
  if (previewKind === 'image') {
    return {
      kind: 'url',
      url: file.content.startsWith('data:')
        ? file.content
        : `data:${file.type || 'image/*'};base64,${file.content}`,
    }
  }

  return {
    content: file.content,
    filename: file.path.split('/').pop() || file.path,
    kind: 'blob',
    mimeType: previewKind === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
  }
}

export function buildRuntimeInfoSummary(input: {
  fileCount: number
  runtimeStatus: RuntimeStatusPayload | null
  selectedPath: string
  workspaceDir?: string
}) {
  const status = input.runtimeStatus?.status || (input.runtimeStatus?.running ? 'running' : 'idle')
  const mode = input.runtimeStatus?.mode === 'docker' ? 'Docker' : input.runtimeStatus?.mode || 'runtime'
  const lines = [`运行状态：${status}`, `运行模式：${mode}`]

  if (input.runtimeStatus?.containerName) lines.push(`容器：${input.runtimeStatus.containerName}`)
  if (input.workspaceDir) lines.push(`工作目录：${input.workspaceDir}`)
  if (input.selectedPath) lines.push(`当前文件：${input.selectedPath}`)
  lines.push(`文件数量：${input.fileCount}`)

  return lines.join('\n')
}
