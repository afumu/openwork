export interface ArtifactSummaryFile {
  name: string
  path: string
}

export function selectVisibleArtifactSummaryFiles<T extends ArtifactSummaryFile>(files: T[]): T[] {
  return files
}
