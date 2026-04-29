import { EventEmitter } from 'events';
import { bridgeRuntimeTerminalSockets, createOpenSandboxPtySession } from './runtimeTerminalProxy';
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
  };
}

describe('runtime terminal proxy', () => {
  it('creates an OpenSandbox PTY session in the conversation workspace', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      json: async () => ({ session_id: 'pty-1' }),
      ok: true,
      status: 201,
      text: async () => '{"session_id":"pty-1"}',
    });

    await expect(createOpenSandboxPtySession(createTarget(), fetchImpl)).resolves.toBe('pty-1');

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:44772/pty', {
      body: JSON.stringify({ cwd: '/workspace/conversations/128' }),
      headers: {
        'content-type': 'application/json',
        'x-open-sandbox-token': 'signed',
      },
      method: 'POST',
    });
  });

  it('bridges frontend terminal messages to OpenSandbox PTY frames and output back to JSON', () => {
    const client = new FakeSocket();
    const upstream = new FakeSocket();

    bridgeRuntimeTerminalSockets({ client: client as any, upstream: upstream as any });
    client.emit('message', '{"type":"input","data":"pwd\\n"}');
    client.emit('message', '{"type":"resize","cols":100,"rows":32}');
    upstream.emit('message', Buffer.from([1, ...Buffer.from('/workspace\n')]));

    expect(upstream.sent[0]).toEqual(Buffer.from([0, ...Buffer.from('pwd\n')]));
    expect(upstream.sent[1]).toBe('{"type":"resize","cols":100,"rows":32}');
    expect(client.sent[0]).toBe('{"type":"output","data":"/workspace\\n"}');
  });

  it('suppresses bootstrap output until the startup marker is printed', () => {
    const client = new FakeSocket();
    const upstream = new FakeSocket();
    const onBootstrapComplete = jest.fn();

    bridgeRuntimeTerminalSockets({
      bootstrapMarker: '__OPENWORK_READY__',
      client: client as any,
      onBootstrapComplete,
      upstream: upstream as any,
    });
    upstream.emit(
      'message',
      Buffer.from([1, ...Buffer.from('stty -echo\r\nexport TERM=xterm\r\n__OPENWORK_READY__')]),
    );
    upstream.emit('message', Buffer.from([1, ...Buffer.from('\r\nbash-5.2# ')]));

    expect(onBootstrapComplete).toHaveBeenCalledTimes(1);
    expect(client.sent).toEqual(['{"type":"output","data":"\\r\\nbash-5.2# "}']);
  });
});
