import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const chatBaseSource = readFileSync(new URL('../views/chat/chatBase.vue', import.meta.url), 'utf8')
const siderListSource = readFileSync(
  new URL('../views/chat/components/sider/List.vue', import.meta.url),
  'utf8'
)
const footerSource = readFileSync(
  new URL('../views/chat/components/Footer/index.vue', import.meta.url),
  'utf8'
)

test('runtime workspace is shown only for project groups', () => {
  assert.match(chatBaseSource, /isActiveProjectGroup/)
  assert.match(chatBaseSource, /shouldShowRuntimeWorkspace[\s\S]*isActiveProjectGroup\.value/)
})

test('sidebar renders separate conversation and project sections', () => {
  assert.match(siderListSource, /partitionGroupsByType/)
  assert.match(siderListSource, /conversationList/)
  assert.match(siderListSource, /projectList/)
  assert.match(siderListSource, /对话记录/)
  assert.match(siderListSource, /项目/)
})

test('empty composer exposes ordinary chat and project mode tabs', () => {
  assert.match(footerSource, /selectedGroupType/)
  assert.match(footerSource, /普通对话/)
  assert.match(footerSource, /项目/)
})
