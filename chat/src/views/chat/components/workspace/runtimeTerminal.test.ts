import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRuntimeTerminalWsUrl, parseRuntimeTerminalServerMessage } from './runtimeTerminal'

test('buildRuntimeTerminalWsUrl converts absolute api url to websocket endpoint', () => {
  assert.equal(
    buildRuntimeTerminalWsUrl({
      apiBaseUrl: 'http://127.0.0.1:9520/api',
      cols: 120,
      groupId: 10,
      rows: 24,
      token: 'abc 123',
      windowLocation: new URL('http://localhost:9002/chat'),
    }),
    'ws://127.0.0.1:9520/api/openwork/runtime/terminal?groupId=10&token=abc+123&cols=120&rows=24'
  )
})

test('buildRuntimeTerminalWsUrl converts relative api url using current origin', () => {
  assert.equal(
    buildRuntimeTerminalWsUrl({
      apiBaseUrl: '/api',
      cols: 80,
      groupId: 10,
      rows: 20,
      token: 'abc',
      windowLocation: new URL('https://openwork.example.com/chat'),
    }),
    'wss://openwork.example.com/api/openwork/runtime/terminal?groupId=10&token=abc&cols=80&rows=20'
  )
})

test('parseRuntimeTerminalServerMessage accepts terminal output messages', () => {
  assert.deepEqual(parseRuntimeTerminalServerMessage('{"type":"output","data":"hello"}'), {
    data: 'hello',
    type: 'output',
  })
})

test('parseRuntimeTerminalServerMessage accepts terminal ready metadata', () => {
  assert.deepEqual(
    parseRuntimeTerminalServerMessage(
      '{"type":"ready","containerName":"sbx-1","cwd":"/workspace","shell":"/bin/bash"}'
    ),
    {
      containerName: 'sbx-1',
      cwd: '/workspace',
      shell: '/bin/bash',
      type: 'ready',
    }
  )
})

test('parseRuntimeTerminalServerMessage ignores invalid server messages', () => {
  assert.equal(parseRuntimeTerminalServerMessage('not json'), null)
  assert.equal(parseRuntimeTerminalServerMessage('{"type":"output"}'), null)
})
