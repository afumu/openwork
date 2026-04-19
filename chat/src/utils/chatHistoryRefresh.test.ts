import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const chatBaseSource = readFileSync(new URL('../views/chat/chatBase.vue', import.meta.url), 'utf8')

test('chat stream completion refreshes the active history from the server', () => {
  const finallyStart = chatBaseSource.indexOf('} finally {')
  const finallyEnd = chatBaseSource.indexOf('activeStreamRequest.value = null', finallyStart)
  const finallyBlock = chatBaseSource.slice(finallyStart, finallyEnd)

  assert.ok(finallyStart > 0)
  assert.ok(finallyEnd > finallyStart)
  assert.match(finallyBlock, /await chatStore\.queryActiveChatLogList\(\)/)
})
