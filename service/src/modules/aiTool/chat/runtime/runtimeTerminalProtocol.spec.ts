import {
  decodeOpenSandboxPtyFrame,
  encodeOpenSandboxPtyInput,
  parseRuntimeTerminalClientMessage,
} from './runtimeTerminalProtocol';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('runtime terminal protocol helpers', () => {
  it('encodes frontend terminal input as OpenSandbox PTY stdin frames', () => {
    expect(encodeOpenSandboxPtyInput('ls -la\n')).toEqual(
      Buffer.from([0, ...Buffer.from('ls -la\n')]),
    );
  });

  it('decodes OpenSandbox PTY stdout frames into frontend output messages', () => {
    expect(decodeOpenSandboxPtyFrame(Buffer.from([1, ...Buffer.from('hello\n')]))).toEqual({
      data: 'hello\n',
      type: 'output',
    });
  });

  it('accepts frontend resize messages for the PTY websocket', () => {
    expect(parseRuntimeTerminalClientMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
      cols: 120,
      rows: 40,
      type: 'resize',
    });
  });
});
