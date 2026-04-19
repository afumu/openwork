import test from 'node:test'
import assert from 'node:assert/strict'

import { flushStreamJsonBuffer, parseStreamJsonLines } from './streamJsonLines'

test('parseStreamJsonLines buffers partial tool execution chunks until a full json line arrives', () => {
  const firstChunk = '\n{"tool_execution_delta":{"tool_call_id":"tool-1"'
  const firstPass = parseStreamJsonLines<{ tool_execution_delta: { tool_call_id: string } }>(
    firstChunk
  )

  assert.deepEqual(firstPass.items, [])
  assert.equal(firstPass.buffer, '{"tool_execution_delta":{"tool_call_id":"tool-1"')

  const secondChunk = ',"tool_name":"bash","event":"start","phase":"executing"}}\n'
  const secondPass = parseStreamJsonLines<{ tool_execution_delta: { tool_call_id: string } }>(
    secondChunk,
    firstPass.buffer
  )

  assert.deepEqual(secondPass.items, [
    {
      tool_execution_delta: {
        event: 'start',
        phase: 'executing',
        tool_call_id: 'tool-1',
        tool_name: 'bash',
      },
    },
  ])
  assert.equal(secondPass.buffer, '')
})

test('flushStreamJsonBuffer parses the final unterminated json line', () => {
  const items = flushStreamJsonBuffer<{ finishReason: string }>('{"finishReason":"stop"}')

  assert.deepEqual(items, [
    {
      finishReason: 'stop',
    },
  ])
})
