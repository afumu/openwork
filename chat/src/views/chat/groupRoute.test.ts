import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  buildGroupRouteQuery,
  parseRouteGroupId,
  resolveActiveGroupId,
  shouldSyncActiveGroupToRoute,
} from './groupRoute'

test('parses numeric group id from route query', () => {
  assert.equal(parseRouteGroupId({ groupId: '123' }), 123)
  assert.equal(parseRouteGroupId({ groupId: ['456'] }), 456)
})

test('ignores missing or invalid group id route query', () => {
  assert.equal(parseRouteGroupId({}), null)
  assert.equal(parseRouteGroupId({ groupId: 'abc' }), null)
  assert.equal(parseRouteGroupId({ groupId: '0' }), null)
  assert.equal(parseRouteGroupId({ groupId: '-1' }), null)
})

test('resolves url group id before local active group id', () => {
  const groups = [{ uuid: 1 }, { uuid: 2 }, { uuid: 3 }]

  assert.equal(resolveActiveGroupId(groups, 1, 3), 3)
})

test('falls back to existing active group id then first group id', () => {
  const groups = [{ uuid: 1 }, { uuid: 2 }]

  assert.equal(resolveActiveGroupId(groups, 2, 99), 2)
  assert.equal(resolveActiveGroupId(groups, 99, 99), 1)
  assert.equal(resolveActiveGroupId([], 2, 2), 0)
})

test('builds group route query while preserving other query values', () => {
  assert.deepEqual(buildGroupRouteQuery({ tab: 'files' }, 12), {
    tab: 'files',
    groupId: '12',
  })
  assert.deepEqual(buildGroupRouteQuery({ groupId: '12', tab: 'files' }, 0), {
    tab: 'files',
  })
})

test('detects when active group should be written to route query', () => {
  assert.equal(shouldSyncActiveGroupToRoute(12, { groupId: '12' }), false)
  assert.equal(shouldSyncActiveGroupToRoute(12, { groupId: '10' }), true)
  assert.equal(shouldSyncActiveGroupToRoute(12, {}), true)
  assert.equal(shouldSyncActiveGroupToRoute(0, { groupId: '10' }), false)
})
