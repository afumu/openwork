import type {
  ArtifactManifest,
  ArtifactWorkspaceDirectoryItem,
  ArtifactWorkspaceFileItem,
  ArtifactWorkspaceTreeItem,
  RuntimePreviewKind,
} from './types'

export function unwrapArtifactPayload<T = ArtifactManifest>(payload: any): T | null {
  if (!payload || typeof payload !== 'object') return null
  if ('runs' in payload || 'workspaceFiles' in payload || 'workspaceTree' in payload) {
    return payload as T
  }
  if ('content' in payload && 'path' in payload) {
    return payload as T
  }
  if ('data' in payload) return unwrapArtifactPayload<T>(payload.data)
  return null
}

export function flattenArtifactManifestFiles(
  manifest: ArtifactManifest | null
): ArtifactWorkspaceFileItem[] {
  if (!manifest) return []

  if (manifest.workspaceFiles?.length) {
    return manifest.workspaceFiles.slice().sort(sortFiles)
  }

  return (manifest.runs || [])
    .flatMap(run =>
      run.files.map(file => ({
        ...file,
        path:
          run.source === 'artifacts_root'
            ? `data/${run.runId}/${file.path}`
            : `${run.runId}/${file.path}`,
        runId: run.runId,
        source: run.source,
      }))
    )
    .sort(sortFiles)
}

export function buildWorkspaceTreeFromFiles(
  files: ArtifactWorkspaceFileItem[]
): ArtifactWorkspaceTreeItem[] {
  const root: ArtifactWorkspaceTreeItem[] = []
  const directoryIndex = new Map<string, ArtifactWorkspaceDirectoryItem>()

  files.forEach(file => {
    const segments = file.path.split('/').filter(Boolean)
    let currentChildren = root
    let currentPath = ''

    segments.slice(0, -1).forEach(segment => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let directory = directoryIndex.get(currentPath)

      if (!directory) {
        directory = {
          children: [],
          name: segment,
          nodeType: 'directory',
          path: currentPath,
          updatedAt: file.updatedAt,
        }
        directoryIndex.set(currentPath, directory)
        currentChildren.push(directory)
      }

      currentChildren = directory.children
    })

    currentChildren.push({ ...file, nodeType: 'file' })
  })

  return sortWorkspaceTree(root)
}

export function resolvePreviewKind(path: string, mimeType = ''): RuntimePreviewKind {
  const ext = getFileExtension(path)
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image'
  }
  if (['html', 'htm'].includes(ext) || mimeType.includes('html')) return 'html'
  if (['md', 'markdown'].includes(ext) || mimeType.includes('markdown')) return 'markdown'
  if (
    ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'less', 'vue', 'py', 'sh', 'yaml', 'yml'].includes(
      ext
    )
  ) {
    return 'code'
  }
  return path ? 'text' : 'empty'
}

function getFileExtension(path: string) {
  const fileName = path.split('?')[0]?.split('/').pop() || path
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}

function sortFiles(left: ArtifactWorkspaceFileItem, right: ArtifactWorkspaceFileItem) {
  const byTime = right.updatedAt.localeCompare(left.updatedAt)
  if (byTime !== 0) return byTime
  return left.path.localeCompare(right.path)
}

export function sortWorkspaceTree(nodes: ArtifactWorkspaceTreeItem[]): ArtifactWorkspaceTreeItem[] {
  return nodes
    .slice()
    .sort((left, right) => {
      if (left.nodeType !== right.nodeType) return left.nodeType === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    .map(node =>
      node.nodeType === 'directory'
        ? {
            ...node,
            children: sortWorkspaceTree(node.children),
          }
        : node
    )
}
