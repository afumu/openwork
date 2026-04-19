interface ArtifactFileRevision {
  path: string
  runId?: string | null
  updatedAt?: string
}

interface ArtifactPreviewReadResult {
  path?: string
  runId?: string | null
  updatedAt?: string
}

interface ShouldRefreshSelectedArtifactOptions {
  previewVisible: boolean
  readResult: ArtifactPreviewReadResult | null
  selectedFile: ArtifactFileRevision | null
  selectedPath: string
}

export function shouldRefreshSelectedArtifact(options: ShouldRefreshSelectedArtifactOptions) {
  const { previewVisible, readResult, selectedFile, selectedPath } = options

  if (!previewVisible || !selectedPath || !selectedFile) return false
  if (!readResult) return true
  if (readResult.path && readResult.path !== selectedFile.path) return true
  if ((readResult.runId || null) !== (selectedFile.runId || null)) return true
  return readResult.updatedAt !== selectedFile.updatedAt
}

export function getArtifactMarkdownTheme(isDarkTheme: boolean) {
  return isDarkTheme ? 'dark' : 'light'
}
