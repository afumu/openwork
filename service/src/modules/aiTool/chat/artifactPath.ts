export function normalizeArtifactReadPath(artifactPath: string, runId?: string) {
  const trimmedPath = String(artifactPath || '')
    .trim()
    .replace(/^\.?\//, '');
  const normalizedRunId = String(runId || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!trimmedPath || !normalizedRunId) {
    return trimmedPath;
  }

  const dataPrefix = `data/${normalizedRunId}/`;
  if (trimmedPath.startsWith(dataPrefix)) {
    return trimmedPath.slice(dataPrefix.length);
  }

  const runPrefix = `${normalizedRunId}/`;
  if (trimmedPath.startsWith(runPrefix)) {
    return trimmedPath.slice(runPrefix.length);
  }

  return trimmedPath;
}
