import test from 'node:test'
import assert from 'node:assert/strict'

import { getArtifactMarkdownTheme, shouldRefreshSelectedArtifact } from './artifactPreview'

test('does not refresh an open artifact preview when the selected file metadata is unchanged', () => {
  assert.equal(
    shouldRefreshSelectedArtifact({
      previewVisible: true,
      selectedPath: 'reports/daily.md',
      selectedFile: {
        path: 'reports/daily.md',
        runId: 'run-1',
        updatedAt: '2026-04-17T10:00:00.000Z',
      },
      readResult: {
        path: 'reports/daily.md',
        runId: 'run-1',
        updatedAt: '2026-04-17T10:00:00.000Z',
      },
    }),
    false
  )
})

test('refreshes an open artifact preview when the selected file gets a newer revision', () => {
  assert.equal(
    shouldRefreshSelectedArtifact({
      previewVisible: true,
      selectedPath: 'reports/daily.md',
      selectedFile: {
        path: 'reports/daily.md',
        runId: 'run-1',
        updatedAt: '2026-04-17T10:05:00.000Z',
      },
      readResult: {
        path: 'reports/daily.md',
        runId: 'run-1',
        updatedAt: '2026-04-17T10:00:00.000Z',
      },
    }),
    true
  )
})

test('refreshes an open artifact preview when content has not been loaded yet', () => {
  assert.equal(
    shouldRefreshSelectedArtifact({
      previewVisible: true,
      selectedPath: 'reports/daily.md',
      selectedFile: {
        path: 'reports/daily.md',
        runId: 'run-1',
        updatedAt: '2026-04-17T10:05:00.000Z',
      },
      readResult: null,
    }),
    true
  )
})

test('maps markdown preview theme to the active app theme', () => {
  assert.equal(getArtifactMarkdownTheme(true), 'dark')
  assert.equal(getArtifactMarkdownTheme(false), 'light')
})
