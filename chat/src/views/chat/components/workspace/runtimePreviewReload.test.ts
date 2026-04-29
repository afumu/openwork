import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readSource(file: string) {
  return readFileSync(resolve(__dirname, file), 'utf8')
}

test('runtime preview iframe is keyed so stale Bad Gateway pages can be reloaded', () => {
  const paneSource = readSource('RuntimePreviewPane.vue')
  const panelSource = readSource('RuntimeWorkspacePanel.vue')

  assert.match(paneSource, /appPreviewReloadKey/)
  assert.match(paneSource, /previewFrameKey/)
  assert.match(paneSource, /schedulePreviewReload/)
  assert.match(panelSource, /previewManualReloadKey/)
})
