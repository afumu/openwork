import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIdeTreeNodes,
  resolveIdeTreeNodePayload,
  resolveCodeLanguage,
  resolveIdeTabTitle,
  toTerminalLines,
  unwrapRuntimeCommandPayload,
} from './ideWorkspace'
import type { ArtifactWorkspaceTreeItem } from './types'

test('buildIdeTreeNodes converts workspace tree items to stable tree nodes', () => {
  const tree: ArtifactWorkspaceTreeItem[] = [
    {
      children: [
        {
          name: 'main.ts',
          nodeType: 'file',
          path: 'src/main.ts',
          runId: null,
          size: 10,
          type: 'text/typescript',
          updatedAt: '2026-04-26T01:00:00.000Z',
        },
      ],
      name: 'src',
      nodeType: 'directory',
      path: 'src',
      updatedAt: '2026-04-26T01:00:00.000Z',
    },
  ]

  assert.deepEqual(buildIdeTreeNodes(tree), [
    {
      children: [
        {
          data: {
            nodeType: 'file',
            path: 'src/main.ts',
            runId: null,
            type: 'text/typescript',
          },
          id: 'file:src/main.ts',
          label: 'main.ts',
        },
      ],
      data: {
        nodeType: 'directory',
        path: 'src',
      },
      id: 'directory:src',
      label: 'src',
    },
  ])
})

test('resolveCodeLanguage maps common runtime files to CodeMirror languages', () => {
  assert.equal(resolveCodeLanguage('src/main.ts', 'text/typescript'), 'typescript')
  assert.equal(resolveCodeLanguage('index.html', 'text/html'), 'html')
  assert.equal(resolveCodeLanguage('package.json', 'application/json'), 'json')
  assert.equal(resolveCodeLanguage('README.md', 'text/markdown'), 'markdown')
  assert.equal(resolveCodeLanguage('server.py', 'text/x-python'), 'python')
  assert.equal(resolveCodeLanguage('unknown.file', 'text/plain'), 'text')
})

test('resolveIdeTabTitle falls back to empty editor title', () => {
  assert.equal(resolveIdeTabTitle(null), '代码编辑器')
  assert.equal(resolveIdeTabTitle({ path: 'src/main.ts' }), 'main.ts')
})

test('resolveIdeTreeNodePayload reads vue-tree meta model payloads', () => {
  const payload = {
    nodeType: 'file' as const,
    path: 'index.html',
    runId: null,
    type: 'text/html',
  }

  assert.deepEqual(resolveIdeTreeNodePayload({ data: { data: payload } }), payload)
  assert.deepEqual(resolveIdeTreeNodePayload({ data: payload }), payload)
  assert.equal(resolveIdeTreeNodePayload({ data: { label: 'index.html' } }), null)
})

test('toTerminalLines formats tool executions as terminal lines', () => {
  const lines = toTerminalLines([
    {
      tool_name: 'shell',
      phase: 'executing',
      args_preview: 'pnpm test',
    },
    {
      tool_name: 'read',
      phase: 'completed',
      result_preview: 'README.md',
    },
  ])

  assert.deepEqual(lines, ['$ shell executing pnpm test', '$ read completed README.md'])
})

test('unwrapRuntimeCommandPayload ignores the API envelope code and unwraps command result', () => {
  const payload = {
    code: 200,
    data: {
      data: {
        code: 0,
        command: 'cd',
        containerName: 'openwork-user-1-group-10',
        cwd: '/workspace/conversations/10',
        mode: 'docker',
        stderr: '',
        stdout: '',
      },
      success: true,
    },
    success: true,
  }

  assert.deepEqual(unwrapRuntimeCommandPayload(payload), {
    code: 0,
    command: 'cd',
    containerName: 'openwork-user-1-group-10',
    cwd: '/workspace/conversations/10',
    mode: 'docker',
    stderr: '',
    stdout: '',
  })
})
