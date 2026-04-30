import test from 'node:test'
import assert from 'node:assert/strict'
import { useRuntimeWorkspaceTabs } from './useRuntimeWorkspaceTabs'
import type { ArtifactReadResult, ArtifactWorkspaceFileItem } from './types'

function readResult(path: string, content: string, updatedAt: string): ArtifactReadResult {
  return {
    content,
    path,
    size: content.length,
    truncated: false,
    type: 'text/plain',
    updatedAt,
  }
}

function fileRecord(path: string, updatedAt: string): ArtifactWorkspaceFileItem {
  return {
    name: path.split('/').pop() || path,
    path,
    runId: null,
    size: 1,
    type: 'text/plain',
    updatedAt,
  }
}

test('workspace tabs open existing files once and track dirty content', () => {
  const tabs = useRuntimeWorkspaceTabs()

  tabs.upsertTab(readResult('src/index.ts', 'one', '2026-04-30T00:00:00.000Z'))
  tabs.upsertTab(readResult('src/index.ts', 'one', '2026-04-30T00:00:00.000Z'))
  assert.equal(tabs.tabs.value.length, 1)
  assert.equal(tabs.activePath.value, 'src/index.ts')

  tabs.updateActiveContent('two')
  assert.equal(tabs.activeTab.value?.dirty, true)
  assert.equal(tabs.activeTab.value?.content, 'two')
})

test('workspace tabs reload clean external updates and flag dirty conflicts', () => {
  const tabs = useRuntimeWorkspaceTabs()

  tabs.upsertTab(readResult('clean.ts', 'clean', '2026-04-30T00:00:00.000Z'))
  assert.equal(tabs.markExternalUpdate(fileRecord('clean.ts', '2026-04-30T00:01:00.000Z')), 'reload')

  tabs.upsertTab(readResult('dirty.ts', 'before', '2026-04-30T00:00:00.000Z'))
  tabs.updateActiveContent('local')
  assert.equal(tabs.markExternalUpdate(fileRecord('dirty.ts', '2026-04-30T00:01:00.000Z')), 'conflict')
  assert.equal(tabs.activeTab.value?.conflict, true)
})

test('workspace tabs confirm before closing dirty tabs', () => {
  const tabs = useRuntimeWorkspaceTabs()

  tabs.upsertTab(readResult('dirty.ts', 'before', '2026-04-30T00:00:00.000Z'))
  tabs.updateActiveContent('local')

  assert.equal(tabs.closeTab('dirty.ts', () => false), false)
  assert.equal(tabs.tabs.value.length, 1)
  assert.equal(tabs.closeTab('dirty.ts', () => true), true)
  assert.equal(tabs.tabs.value.length, 0)
})
