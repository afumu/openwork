import { StringDecoder } from 'string_decoder';

export type RuntimeTerminalClientMessage =
  | {
      data: string;
      type: 'input';
    }
  | {
      cols: number;
      rows: number;
      type: 'resize';
    }
  | {
      signal: string;
      type: 'signal';
    };

export type RuntimeTerminalServerMessage =
  | {
      data: string;
      type: 'output';
    }
  | {
      code?: number;
      signal?: number;
      type: 'exit';
    }
  | {
      message: string;
      type: 'error';
    };

export function encodeOpenSandboxPtyInput(data: string) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(data)]);
}

export function decodeOpenSandboxPtyFrame(
  frame: Buffer,
  decoder = new StringDecoder('utf8'),
): RuntimeTerminalServerMessage | null {
  if (!frame.length) return null;

  const channel = frame[0];
  if (channel !== 1 && channel !== 2 && channel !== 3) return null;

  const payloadOffset = channel === 3 ? 9 : 1;
  if (frame.length <= payloadOffset) return null;

  return {
    data: decoder.write(frame.subarray(payloadOffset)),
    type: 'output',
  };
}

export function parseRuntimeTerminalClientMessage(
  value: string,
): RuntimeTerminalClientMessage | null {
  let parsed: any;

  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    return null;
  }

  if (parsed?.type === 'input' && typeof parsed.data === 'string') {
    return {
      data: parsed.data,
      type: 'input',
    };
  }

  if (
    parsed?.type === 'resize' &&
    Number.isFinite(Number(parsed.cols)) &&
    Number.isFinite(Number(parsed.rows))
  ) {
    return {
      cols: Number(parsed.cols),
      rows: Number(parsed.rows),
      type: 'resize',
    };
  }

  if (parsed?.type === 'signal' && typeof parsed.signal === 'string') {
    return {
      signal: parsed.signal,
      type: 'signal',
    };
  }

  return null;
}

export function serializeRuntimeTerminalServerMessage(message: RuntimeTerminalServerMessage) {
  if (message.type === 'output') {
    return JSON.stringify({ type: message.type, data: message.data });
  }
  if (message.type === 'exit') {
    return JSON.stringify({ type: message.type, code: message.code, signal: message.signal });
  }
  return JSON.stringify({ type: message.type, message: message.message });
}
