import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const drawerSource = readSource('../views/chat/components/ArtifactsDrawer.vue')
const wechatPublishModalSource = readSource('../views/chat/components/WechatPublishModal.vue')

test('artifact markdown preview restores ordered and unordered list markers', () => {
  assert.match(drawerSource, /\.artifact-modal-doc-surface :deep\(\.md-editor-preview ul\)/)
  assert.match(drawerSource, /list-style:\s*disc/)
  assert.match(drawerSource, /\.artifact-modal-doc-surface :deep\(\.md-editor-preview ol\)/)
  assert.match(drawerSource, /list-style:\s*decimal/)
})

test('wechat publish preview restores ordered and unordered list markers', () => {
  assert.match(wechatPublishModalSource, /\.wechat-md-preview :deep\(ul\)/)
  assert.match(wechatPublishModalSource, /list-style:\s*disc/)
  assert.match(wechatPublishModalSource, /\.wechat-md-preview :deep\(ol\)/)
  assert.match(wechatPublishModalSource, /list-style:\s*decimal/)
})
