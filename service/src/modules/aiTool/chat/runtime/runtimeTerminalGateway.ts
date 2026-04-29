import { RedisCacheService } from '@/modules/redisCache/redisCache.service';
import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { OpenSandboxRuntimeService } from './opensandboxRuntime.service';
import type { RuntimeTerminalTarget } from './opensandboxRuntime.types';
import {
  bridgeRuntimeTerminalSockets,
  buildOpenSandboxPtyWebSocketUrl,
  createOpenSandboxPtySession,
  encodeRuntimeTerminalBootstrapInput,
  RUNTIME_TERMINAL_BOOTSTRAP_MARKER,
} from './runtimeTerminalProxy';

type RuntimeTerminalSocket = {
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): any;
  readyState?: number;
  send(value: any): void;
};

type RuntimeTerminalContext = {
  cols: number;
  groupId: number;
  rows: number;
  userId: number;
};

type RuntimeTerminalAttachOptions = {
  createSession?: (target: RuntimeTerminalTarget) => Promise<string>;
  createUpstreamSocket?: (
    target: RuntimeTerminalTarget,
    sessionId: string,
  ) => RuntimeTerminalSocket;
};

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 24;
const RUNTIME_TERMINAL_PATH = '/api/openwork/runtime/terminal';

function sendJson(socket: RuntimeTerminalSocket, value: Record<string, any>) {
  socket.send(JSON.stringify(value));
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

@Injectable()
export class RuntimeTerminalGateway {
  private readonly logger = new Logger(RuntimeTerminalGateway.name);
  private websocketServer: WebSocketServer | null = null;

  constructor(
    private readonly runtimeService: OpenSandboxRuntimeService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  bind(server: Server) {
    if (this.websocketServer) return;

    const websocketServer = new WebSocketServer({ noServer: true });
    this.websocketServer = websocketServer;

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!this.isRuntimeTerminalUpgrade(request.url || '')) return;

      void this.resolveUpgradeContext(request)
        .then(context => {
          websocketServer.handleUpgrade(request, socket, head, client => {
            void this.handleTerminalSocket(client, context);
          });
        })
        .catch(error => {
          this.logger.warn(
            `终端 WebSocket 鉴权失败: ${error instanceof Error ? error.message : String(error)}`,
          );
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
        });
    });
  }

  isRuntimeTerminalUpgrade(rawUrl: string) {
    try {
      return new URL(rawUrl, 'http://localhost').pathname === RUNTIME_TERMINAL_PATH;
    } catch (_error) {
      return false;
    }
  }

  async handleTerminalSocket(
    client: RuntimeTerminalSocket,
    context: RuntimeTerminalContext,
    options: RuntimeTerminalAttachOptions = {},
  ) {
    const target = await this.runtimeService.getRuntimeTerminalTarget({
      groupId: context.groupId,
      userId: context.userId,
    });

    if (!target) {
      sendJson(client, { type: 'error', message: '当前对话还没有可连接的运行时' });
      client.close();
      return;
    }

    const createSession = options.createSession || createOpenSandboxPtySession;
    const createUpstreamSocket =
      options.createUpstreamSocket ||
      ((runtimeTarget: RuntimeTerminalTarget, sessionId: string) =>
        new WebSocket(buildOpenSandboxPtyWebSocketUrl(runtimeTarget, sessionId), {
          headers: runtimeTarget.endpointHeaders,
        }) as RuntimeTerminalSocket);

    try {
      const sessionId = await createSession(target);
      const upstream = createUpstreamSocket(target, sessionId);
      const sendReady = () => {
        sendJson(client, {
          type: 'ready',
          containerName: target.sandboxId,
          cwd: target.workspacePath,
          shell: target.shell,
        });
      };
      bridgeRuntimeTerminalSockets({
        bootstrapMarker: RUNTIME_TERMINAL_BOOTSTRAP_MARKER,
        client,
        onBootstrapComplete: sendReady,
        upstream,
      });

      await new Promise<void>((resolve, reject) => {
        upstream.on('open', () => {
          upstream.send(
            JSON.stringify({
              type: 'resize',
              cols: context.cols,
              rows: context.rows,
            }),
          );
          upstream.send(encodeRuntimeTerminalBootstrapInput());
          resolve();
        });
        upstream.on('error', reject);
      });
    } catch (error) {
      sendJson(client, {
        type: 'error',
        message: error instanceof Error ? error.message : '终端连接失败',
      });
      client.close();
    }
  }

  private async resolveUpgradeContext(request: IncomingMessage): Promise<RuntimeTerminalContext> {
    const url = new URL(request.url || '', 'http://localhost');
    const token = url.searchParams.get('token');
    const groupId = Number(url.searchParams.get('groupId'));

    if (!token || !Number.isFinite(groupId) || groupId <= 0) {
      throw new Error('missing token or groupId');
    }

    const secret = await this.redisCacheService.getJwtSecret();
    const user = jwt.verify(token, secret) as any;
    await this.redisCacheService.checkTokenAuth(token, { user });

    return {
      cols: parsePositiveInteger(url.searchParams.get('cols'), DEFAULT_TERMINAL_COLS),
      groupId,
      rows: parsePositiveInteger(url.searchParams.get('rows'), DEFAULT_TERMINAL_ROWS),
      userId: Number(user.id),
    };
  }
}
