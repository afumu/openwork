import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkspaceTreeFromFiles,
  flattenArtifactManifestFiles,
  resolvePreviewKind,
  unwrapArtifactPayload,
} from './artifactWorkspace'

test('unwrapArtifactPayload unwraps nested data payloads', () => {
  const payload = { data: { data: { workspaceFiles: [{ path: 'index.html' }] } } }

  assert.deepEqual(unwrapArtifactPayload(payload), {
    workspaceFiles: [{ path: 'index.html' }],
  })
})

test('unwrapArtifactPayload unwraps nested artifact read results', () => {
  const payload = {
    code: 200,
    data: {
      data: {
        content: '<!doctype html><html></html>',
        path: 'snake.html',
        size: 31,
        success: true,
        truncated: false,
        type: 'html',
        updatedAt: '2026-04-26T04:37:13.080Z',
      },
      success: true,
    },
    success: true,
  }

  assert.deepEqual(unwrapArtifactPayload(payload), {
    content: '<!doctype html><html></html>',
    path: 'snake.html',
    size: 31,
    success: true,
    truncated: false,
    type: 'html',
    updatedAt: '2026-04-26T04:37:13.080Z',
  })
})

test('flattenArtifactManifestFiles prefers workspace files when present', () => {
  const files = flattenArtifactManifestFiles({
    workspaceFiles: [
      {
        name: 'index.html',
        path: 'projects/index.html',
        size: 10,
        type: 'text/html',
        updatedAt: '2026-04-26T01:00:00.000Z',
        runId: null,
      },
    ],
    runs: [
      {
        runId: 'run-1',
        files: [
          {
            name: 'old.md',
            path: 'old.md',
            size: 5,
            type: 'text/markdown',
            updatedAt: '2026-04-25T01:00:00.000Z',
          },
        ],
      },
    ],
  })

  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'projects/index.html')
})

test('buildWorkspaceTreeFromFiles sorts directories before files', () => {
  const tree = buildWorkspaceTreeFromFiles([
    {
      name: 'README.md',
      path: 'README.md',
      size: 10,
      type: 'text/markdown',
      updatedAt: '2026-04-26T01:00:00.000Z',
      runId: null,
    },
    {
      name: 'main.ts',
      path: 'src/main.ts',
      size: 20,
      type: 'text/typescript',
      updatedAt: '2026-04-26T01:01:00.000Z',
      runId: null,
    },
  ])

  assert.equal(tree[0].nodeType, 'directory')
  assert.equal(tree[0].name, 'src')
  assert.equal(tree[1].nodeType, 'file')
  assert.equal(tree[1].name, 'README.md')
})

test('resolvePreviewKind detects html, markdown, image, and code files', () => {
  assert.equal(resolvePreviewKind('index.html', 'text/html'), 'html')
  assert.equal(resolvePreviewKind('README.md', 'text/markdown'), 'markdown')
  assert.equal(resolvePreviewKind('logo.png', 'image/png'), 'image')
  assert.equal(resolvePreviewKind('src/main.ts', 'text/typescript'), 'code')
})
