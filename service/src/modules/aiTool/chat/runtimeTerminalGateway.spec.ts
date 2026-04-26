import {
  buildRuntimeTerminalSpawn,
  resolveNodePtySpawnHelperPath,
  parseRuntimeTerminalClientMessage,
  parseRuntimeTerminalRequest,
} from './runtimeTerminalGateway';

declare const describe: any;
declare const expect: any;
declare const test: any;

describe('runtime terminal gateway helpers', () => {
  test('parseRuntimeTerminalRequest reads group id and token from websocket url', () => {
    expect(
      parseRuntimeTerminalRequest('/api/openwork/runtime/terminal?groupId=10&token=abc123'),
    ).toEqual({
      cols: 120,
      groupId: 10,
      rows: 24,
      token: 'abc123',
    });
  });

  test('parseRuntimeTerminalRequest clamps initial terminal size', () => {
    expect(
      parseRuntimeTerminalRequest(
        '/api/openwork/runtime/terminal?groupId=10&token=abc123&cols=999&rows=1',
      ),
    ).toEqual({
      cols: 240,
      groupId: 10,
      rows: 8,
      token: 'abc123',
    });
  });

  test('buildRuntimeTerminalSpawn starts an interactive docker shell in the conversation cwd', () => {
    expect(
      buildRuntimeTerminalSpawn({
        containerName: 'openwork-user-1-group-10',
        cwd: '/workspace/conversations/10',
        dockerBinary: 'docker',
      }),
    ).toEqual({
      args: [
        'exec',
        '-it',
        '-w',
        '/workspace/conversations/10',
        'openwork-user-1-group-10',
        '/bin/sh',
        '-lc',
        'exec /bin/bash -l || exec /bin/sh -l',
      ],
      command: 'docker',
    });
  });

  test('resolveNodePtySpawnHelperPath locates the native spawn helper next to node-pty', () => {
    expect(
      resolveNodePtySpawnHelperPath(
        '/repo/service/node_modules/node-pty/lib/index.js',
        'darwin',
        'arm64',
      ),
    ).toBe('/repo/service/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
  });

  test('parseRuntimeTerminalClientMessage accepts input and resize messages', () => {
    expect(parseRuntimeTerminalClientMessage('{"type":"input","data":"ls\\r"}')).toEqual({
      data: 'ls\r',
      type: 'input',
    });
    expect(parseRuntimeTerminalClientMessage('{"type":"resize","cols":200,"rows":2}')).toEqual({
      cols: 200,
      rows: 8,
      type: 'resize',
    });
  });

  test('parseRuntimeTerminalClientMessage ignores invalid client messages', () => {
    expect(parseRuntimeTerminalClientMessage('not json')).toBeNull();
    expect(parseRuntimeTerminalClientMessage('{"type":"input"}')).toBeNull();
  });
});
