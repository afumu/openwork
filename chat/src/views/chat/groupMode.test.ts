import { strict as assert } from 'node:assert'
import test from 'node:test'

import { isProjectGroup, normalizeGroupType, partitionGroupsByType } from './groupMode'

test('normalizes missing or unsupported group types to ordinary chat', () => {
  assert.equal(normalizeGroupType(), 'chat')
  assert.equal(normalizeGroupType('workspace'), 'chat')
  assert.equal(normalizeGroupType('project'), 'project')
})

test('identifies project groups only when groupType is project', () => {
  assert.equal(isProjectGroup({ groupType: 'project' }), true)
  assert.equal(isProjectGroup({ groupType: 'chat' }), false)
  assert.equal(isProjectGroup({}), false)
})

test('partitions groups into conversations and projects', () => {
  const groups = [
    { uuid: 1, title: '普通问答', groupType: 'chat' },
    { uuid: 2, title: '旅行网站', groupType: 'project' },
    { uuid: 3, title: '老记录' },
  ]

  const result = partitionGroupsByType(groups)

  assert.deepEqual(
    result.conversations.map(item => item.uuid),
    [1, 3]
  )
  assert.deepEqual(
    result.projects.map(item => item.uuid),
    [2]
  )
})
