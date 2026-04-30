import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const chatPageSource = readFileSync(new URL('../views/chat/chat.vue', import.meta.url), 'utf8')
const siderSource = readFileSync(
  new URL('../views/chat/components/sider/index.vue', import.meta.url),
  'utf8'
)
const chatStoreSource = readFileSync(
  new URL('../store/modules/chat/index.ts', import.meta.url),
  'utf8'
)

test('chat page keeps active group and groupId query in sync', () => {
  assert.match(chatPageSource, /useRoute/)
  assert.match(chatPageSource, /useRouter/)
  assert.match(chatPageSource, /parseRouteGroupId/)
  assert.match(chatPageSource, /buildGroupRouteQuery/)
  assert.match(chatPageSource, /shouldSyncActiveGroupToRoute/)
  assert.match(chatPageSource, /watch\(\s*\(\) => chatStore\.active/)
})

test('sidebar initializes group list from route group id', () => {
  assert.match(siderSource, /parseRouteGroupId/)
  assert.match(siderSource, /queryMyGroup\(\{ preferredGroupId: parseRouteGroupId\(route\.query\) \}\)/)
})

test('chat store can prefer a route group id when loading groups', () => {
  assert.match(chatStoreSource, /preferredGroupId\?: number \| string \| null/)
  assert.match(chatStoreSource, /resolveActiveGroupId/)
  assert.match(chatStoreSource, /await this\.setActiveGroup\(nextActiveGroupId\)/)
})
