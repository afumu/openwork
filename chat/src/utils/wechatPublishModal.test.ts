import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const modalSource = readSource('../views/chat/components/WechatPublishModal.vue')

test('wechat publish modal exposes theme id as a dropdown of supported built-in themes', () => {
  assert.match(modalSource, /const themeOptions = \[/)
  assert.match(modalSource, /<select\s+[\s\S]*v-model="form\.themeId"/)
  assert.match(modalSource, /value: 'default'/)
  assert.match(modalSource, /value: 'zhihu_default'/)
})

test('wechat publish modal uses an editable markdown workspace with sync-to-artifact action', () => {
  assert.match(modalSource, /MdEditor/)
  assert.match(modalSource, /draftMarkdown/)
  assert.match(modalSource, /同步回原稿/)
})
