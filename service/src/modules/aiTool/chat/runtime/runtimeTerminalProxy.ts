import { StringDecoder } from 'string_decoder';
import type { RuntimeTerminalTarget } from './opensandboxRuntime.types';
import {
  decodeOpenSandboxPtyFrame,
  encodeOpenSandboxPtyInput,
  parseRuntimeTerminalClientMessage,
  serializeRuntimeTerminalServerMessage,
} from './runtimeTerminalProtocol';

type SocketLike = {
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): any;
  readyState?: number;
  send(value: any): void;
};

const OPEN = 1;
export const RUNTIME_TERMINAL_BOOTSTRAP_MARKER = '__OPENWORK_TERMINAL_READY__';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function sendIfOpen(socket: SocketLike, value: any) {
  if (socket.readyState === undefined || socket.readyState === OPEN) {
    socket.send(value);
  }
}

export async function createOpenSandboxPtySession(
  target: RuntimeTerminalTarget,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${stripTrailingSlash(target.execdBaseUrl)}/pty`, {
    body: JSON.stringify({ cwd: target.workspacePath }),
    headers: {
      ...(target.endpointHeaders || {}),
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`OpenSandbox PTY session create failed: HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => null);
  if (!body?.session_id) {
    throw new Error('OpenSandbox PTY session create failed: unexpected response');
  }

  return String(body.session_id);
}

export function buildOpenSandboxPtyWebSocketUrl(target: RuntimeTerminalTarget, sessionId: string) {
  const baseUrl = new URL(stripTrailingSlash(target.execdBaseUrl));
  baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/g, '')}/pty/${encodeURIComponent(
    sessionId,
  )}/ws`;
  return baseUrl.toString();
}

export function buildRuntimeTerminalBootstrapScript() {
  return [
    'stty -echo 2>/dev/null || true',
    'export TERM="${TERM:-xterm-256color}"',
    'export COLORTERM="${COLORTERM:-truecolor}"',
    'll() { ls -alF "$@"; }',
    'la() { ls -A "$@"; }',
    'l() { ls -CF "$@"; }',
    "clear() { command clear \"$@\" 2>/dev/null || printf '\\033[H\\033[2J\\033[3J'; }",
    `printf '\\r${RUNTIME_TERMINAL_BOOTSTRAP_MARKER}'`,
    'stty echo 2>/dev/null || true',
  ].join('\n');
}

export function encodeRuntimeTerminalBootstrapInput() {
  return encodeOpenSandboxPtyInput(`${buildRuntimeTerminalBootstrapScript()}\n`);
}

export function bridgeRuntimeTerminalSockets(input: {
  bootstrapMarker?: string;
  client: SocketLike;
  onBootstrapComplete?: () => void;
  upstream: SocketLike;
}) {
  const decoder = new StringDecoder('utf8');
  const { client, upstream } = input;
  let bootstrapOutputBuffer = '';
  let isSuppressingBootstrapOutput = Boolean(input.bootstrapMarker);

  const sendOutput = (data: string) => {
    if (isSuppressingBootstrapOutput && input.bootstrapMarker) {
      bootstrapOutputBuffer += data;
      const markerIndex = bootstrapOutputBuffer.indexOf(input.bootstrapMarker);

      if (markerIndex === -1) {
        bootstrapOutputBuffer = bootstrapOutputBuffer.slice(-input.bootstrapMarker.length);
        return;
      }

      const remainingOutput = bootstrapOutputBuffer.slice(
        markerIndex + input.bootstrapMarker.length,
      );
      bootstrapOutputBuffer = '';
      isSuppressingBootstrapOutput = false;
      input.onBootstrapComplete?.();

      if (!remainingOutput) return;
      sendIfOpen(
        client,
        serializeRuntimeTerminalServerMessage({
          data: remainingOutput,
          type: 'output',
        }),
      );
      return;
    }

    sendIfOpen(
      client,
      serializeRuntimeTerminalServerMessage({
        data,
        type: 'output',
      }),
    );
  };

  client.on('message', value => {
    const message = parseRuntimeTerminalClientMessage(
      Buffer.isBuffer(value) ? value.toString() : String(value),
    );
    if (!message) return;

    if (message.type === 'input') {
      sendIfOpen(upstream, encodeOpenSandboxPtyInput(message.data));
      return;
    }

    if (message.type === 'resize') {
      sendIfOpen(
        upstream,
        JSON.stringify({ type: 'resize', cols: message.cols, rows: message.rows }),
      );
      return;
    }

    if (message.type === 'signal') {
      sendIfOpen(upstream, JSON.stringify({ type: 'signal', signal: message.signal }));
    }
  });

  upstream.on('message', value => {
    if (Buffer.isBuffer(value)) {
      const message = decodeOpenSandboxPtyFrame(value, decoder);
      if (message?.type === 'output') {
        sendOutput(message.data);
      }
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(String(value));
    } catch (_error) {
      return;
    }

    if (parsed?.type === 'exit') {
      sendIfOpen(
        client,
        serializeRuntimeTerminalServerMessage({
          code: typeof parsed.exit_code === 'number' ? parsed.exit_code : parsed.code,
          signal: typeof parsed.signal === 'number' ? parsed.signal : undefined,
          type: 'exit',
        }),
      );
    }
  });

  const closePeer = (peer: SocketLike) => {
    if (peer.readyState === undefined || peer.readyState === OPEN) {
      peer.close();
    }
  };

  client.on('close', () => closePeer(upstream));
  upstream.on('close', () => closePeer(client));
  upstream.on('error', error => {
    sendIfOpen(
      client,
      serializeRuntimeTerminalServerMessage({
        message: error instanceof Error ? error.message : '终端连接失败',
        type: 'error',
      }),
    );
    closePeer(client);
  });
}
