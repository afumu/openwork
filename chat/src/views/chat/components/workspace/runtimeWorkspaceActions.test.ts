import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRuntimeInfoSummary,
  resolveWorkspaceOpenTarget,
  resolveWorkspaceToolbarCopyText,
} from './runtimeWorkspaceActions'

const htmlFile = {
  content: '<h1>Hello</h1>',
  path: 'index.html',
  size: 14,
  truncated: false,
  type: 'html',
  updatedAt: '2026-04-26T00:00:00.000Z',
}

test('resolveWorkspaceOpenTarget opens html files as html blobs', () => {
  assert.deepEqual(resolveWorkspaceOpenTarget(htmlFile), {
    content: '<h1>Hello</h1>',
    filename: 'index.html',
    kind: 'blob',
    mimeType: 'text/html;charset=utf-8',
  })
})

test('resolveWorkspaceOpenTarget opens data images directly', () => {
  assert.deepEqual(
    resolveWorkspaceOpenTarget({
      ...htmlFile,
      content: 'data:image/png;base64,abc',
      path: 'cover.png',
      type: 'image/png',
    }),
    {
      kind: 'url',
      url: 'data:image/png;base64,abc',
    }
  )
})

test('resolveWorkspaceToolbarCopyText copies selected file content first', () => {
  assert.equal(resolveWorkspaceToolbarCopyText(htmlFile), '<h1>Hello</h1>')
  assert.equal(resolveWorkspaceToolbarCopyText(null), '')
})

test('buildRuntimeInfoSummary formats runtime and workspace context', () => {
  assert.equal(
    buildRuntimeInfoSummary({
      fileCount: 2,
      runtimeStatus: {
        containerName: 'openwork-user-1-group-10',
        groupId: 10,
        mode: 'docker',
        running: true,
        status: 'running',
      },
      selectedPath: 'index.html',
      workspaceDir: '/workspace',
    }),
    [
      '运行状态：running',
      '运行模式：Docker',
      '容器：openwork-user-1-group-10',
      '工作目录：/workspace',
      '当前文件：index.html',
      '文件数量：2',
    ].join('\n')
  )
})
