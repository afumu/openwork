import { EventEmitter } from 'events';
import { RuntimeTerminalGateway } from './runtimeTerminalGateway';
import { RUNTIME_TERMINAL_BOOTSTRAP_MARKER } from './runtimeTerminalProxy';
import type { RuntimeTerminalTarget } from './opensandboxRuntime.types';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  send(value: any) {
    this.sent.push(value);
  }
}

function createTarget(): RuntimeTerminalTarget {
  return {
    endpointHeaders: { 'x-open-sandbox-token': 'signed' },
    execdBaseUrl: 'http://127.0.0.1:44772',
    groupId: 128,
    mode: 'opensandbox',
    sandboxId: 'sbx-1',
    shell: '/bin/bash',
    userId: 42,
    workspacePath: '/workspace/conversations/128',
  } as RuntimeTerminalTarget;
}

describe('RuntimeTerminalGateway', () => {
  it('reports a clear frontend error when the conversation has no runtime', async () => {
    const client = new FakeSocket();
    const gateway = new RuntimeTerminalGateway(
      {
        getRuntimeTerminalTarget: jest.fn().mockResolvedValue(null),
      } as any,
      {} as any,
    );

    await gateway.handleTerminalSocket(client as any, {
      cols: 120,
      groupId: 128,
      rows: 30,
      userId: 42,
    });

    expect(client.sent).toEqual(['{"type":"error","message":"当前对话还没有可连接的运行时"}']);
    expect(client.readyState).toBe(3);
  });

  it('creates a PTY session, connects upstream, and sends ready after upstream opens', async () => {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    const target = createTarget();
    const createSession = jest.fn().mockResolvedValue('pty-1');
    const createUpstreamSocket = jest.fn().mockReturnValue(upstream);
    const gateway = new RuntimeTerminalGateway(
      {
        getRuntimeTerminalTarget: jest.fn().mockResolvedValue(target),
      } as any,
      {} as any,
    );

    const attached = gateway.handleTerminalSocket(
      client as any,
      {
        cols: 100,
        groupId: 128,
        rows: 32,
        userId: 42,
      },
      { createSession, createUpstreamSocket },
    );
    while (!createUpstreamSocket.mock.calls.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
    upstream.emit('open');
    await attached;

    expect(createSession).toHaveBeenCalledWith(target);
    expect(createUpstreamSocket).toHaveBeenCalledWith(target, 'pty-1');
    expect(client.sent).toEqual([]);
    expect(upstream.sent[0]).toBe('{"type":"resize","cols":100,"rows":32}');
    expect(Buffer.isBuffer(upstream.sent[1])).toBe(true);
    expect(upstream.sent[1].subarray(1).toString()).toContain(
      'export TERM="${TERM:-xterm-256color}"',
    );
    expect(upstream.sent[1].subarray(1).toString()).toContain('ll() { ls -alF "$@"; }');

    upstream.emit(
      'message',
      Buffer.from([1, ...Buffer.from(`stty -echo\r\n${RUNTIME_TERMINAL_BOOTSTRAP_MARKER}`)]),
    );

    expect(client.sent[0]).toBe(
      '{"type":"ready","containerName":"sbx-1","cwd":"/workspace/conversations/128","shell":"/bin/bash"}',
    );
  });
});
