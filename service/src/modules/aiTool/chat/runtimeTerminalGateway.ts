import { Injectable, Logger } from '@nestjs/common';
import { existsSync, statSync, chmodSync } from 'fs';
import { IncomingMessage, Server } from 'http';
import * as jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import * as pty from 'node-pty';
import { dirname, resolve } from 'path';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { RedisCacheService } from '../../redisCache/redisCache.service';
import {
  PiRuntimeManagerService,
  resolveConversationWorkspace,
  resolveRuntimeWorkspacePath,
} from './piRuntimeManager';

export type RuntimeTerminalRequest = {
  cols: number;
  groupId: number;
  rows: number;
  token: string;
};

export type RuntimeTerminalSpawn = {
  args: string[];
  command: string;
};

export type RuntimeTerminalClientMessage =
  | {
      data: string;
      type: 'input';
    }
  | {
      cols: number;
      rows: number;
      type: 'resize';
    };

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 24;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 8;
const MAX_TERMINAL_COLS = 240;
const MAX_TERMINAL_ROWS = 80;
const TERMINAL_WS_PATH = '/api/openwork/runtime/terminal';
const nodeRequire = createRequire(__filename);

export function clampTerminalDimension(value: unknown, fallback: number, min: number, max: number) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function parseRuntimeTerminalRequest(url = ''): RuntimeTerminalRequest {
  const parsed = new URL(url, 'http://localhost');
  const groupId = Number(parsed.searchParams.get('groupId') || 0);
  const token = String(parsed.searchParams.get('token') || '').trim();

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error('缺少有效的终端 groupId');
  }

  if (!token) {
    throw new Error('缺少终端鉴权 token');
  }

  return {
    cols: clampTerminalDimension(
      parsed.searchParams.get('cols'),
      DEFAULT_TERMINAL_COLS,
      MIN_TERMINAL_COLS,
      MAX_TERMINAL_COLS,
    ),
    groupId,
    rows: clampTerminalDimension(
      parsed.searchParams.get('rows'),
      DEFAULT_TERMINAL_ROWS,
      MIN_TERMINAL_ROWS,
      MAX_TERMINAL_ROWS,
    ),
    token,
  };
}

export function buildRuntimeTerminalSpawn(input: {
  containerName: string;
  cwd: string;
  dockerBinary?: string;
}): RuntimeTerminalSpawn {
  return {
    args: [
      'exec',
      '-it',
      '-w',
      input.cwd,
      input.containerName,
      '/bin/sh',
      '-lc',
      'exec /bin/bash -l || exec /bin/sh -l',
    ],
    command: input.dockerBinary || 'docker',
  };
}

export function resolveNodePtySpawnHelperPath(
  nodePtyEntryPath = nodeRequire.resolve('node-pty'),
  platform = process.platform,
  arch = process.arch,
) {
  return resolve(dirname(nodePtyEntryPath), '..', 'prebuilds', `${platform}-${arch}`, 'spawn-helper');
}

export function ensureNodePtySpawnHelperExecutable() {
  if (process.platform === 'win32') return;

  const helperPath = resolveNodePtySpawnHelperPath();
  if (!existsSync(helperPath)) return;

  const stats = statSync(helperPath);
  if ((stats.mode & 0o111) !== 0) return;

  chmodSync(helperPath, stats.mode | 0o755);
}

export function parseRuntimeTerminalClientMessage(raw: RawData | string) {
  const text = typeof raw === 'string' ? raw : raw.toString();
  let parsed: any;

  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    return null;
  }

  if (parsed?.type === 'input' && typeof parsed.data === 'string') {
    return {
      data: parsed.data,
      type: 'input' as const,
    };
  }

  if (parsed?.type === 'resize') {
    return {
      cols: clampTerminalDimension(
        parsed.cols,
        DEFAULT_TERMINAL_COLS,
        MIN_TERMINAL_COLS,
        MAX_TERMINAL_COLS,
      ),
      rows: clampTerminalDimension(
        parsed.rows,
        DEFAULT_TERMINAL_ROWS,
        MIN_TERMINAL_ROWS,
        MAX_TERMINAL_ROWS,
      ),
      type: 'resize' as const,
    };
  }

  return null;
}

function sendTerminalMessage(ws: WebSocket, payload: Record<string, any>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

@Injectable()
export class RuntimeTerminalGatewayService {
  constructor(
    private readonly piRuntimeManagerService: PiRuntimeManagerService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  private attached = false;
  private readonly sessions = new Set<pty.IPty>();

  attach(server: Server) {
    if (this.attached) return;

    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', 'http://localhost').pathname;
      if (pathname !== TERMINAL_WS_PATH) return;

      wss.handleUpgrade(request, socket, head, ws => {
        void this.handleConnection(ws, request);
      });
    });

    this.attached = true;
  }

  private async handleConnection(ws: WebSocket, request: IncomingMessage) {
    let terminalProcess: pty.IPty | null = null;

    try {
      const terminalRequest = parseRuntimeTerminalRequest(request.url || '');
      const user = await this.authenticate(terminalRequest.token);
      const runtime = await this.piRuntimeManagerService.ensureRuntime({
        groupId: terminalRequest.groupId,
        userId: user.id,
      });

      if (runtime.mode !== 'docker' || !runtime.containerName) {
        throw new Error('当前运行时不是容器模式，无法打开交互式终端');
      }

      const workspaceDir = resolveConversationWorkspace(terminalRequest.groupId);
      const cwd = resolveRuntimeWorkspacePath(
        process.env.PI_DOCKER_WORKSPACE_PATH || '/workspace',
        workspaceDir,
      );
      const spawnConfig = buildRuntimeTerminalSpawn({
        containerName: runtime.containerName,
        cwd,
        dockerBinary: process.env.PI_DOCKER_BINARY || 'docker',
      });

      ensureNodePtySpawnHelperExecutable();
      terminalProcess = pty.spawn(spawnConfig.command, spawnConfig.args, {
        cols: terminalRequest.cols,
        cwd: process.cwd(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
        name: 'xterm-256color',
        rows: terminalRequest.rows,
      });
      this.sessions.add(terminalProcess);

      sendTerminalMessage(ws, {
        containerName: runtime.containerName,
        cwd,
        type: 'ready',
      });

      terminalProcess.onData(data => {
        sendTerminalMessage(ws, { data, type: 'output' });
      });

      terminalProcess.onExit(event => {
        sendTerminalMessage(ws, {
          code: event.exitCode,
          signal: event.signal,
          type: 'exit',
        });
        ws.close();
      });

      ws.on('message', raw => {
        const message = parseRuntimeTerminalClientMessage(raw);
        if (!message || !terminalProcess) return;

        if (message.type === 'input') {
          terminalProcess.write(message.data);
        } else if (message.type === 'resize') {
          terminalProcess.resize(message.cols, message.rows);
        }
      });
    } catch (error: any) {
      Logger.error(
        `runtime terminal connection failed: ${error?.message || error}`,
        error?.stack,
        'RuntimeTerminalGatewayService',
      );
      sendTerminalMessage(ws, {
        message: error?.message || '终端连接失败',
        type: 'error',
      });
      ws.close();
    }

    ws.on('close', () => {
      if (!terminalProcess) return;
      this.sessions.delete(terminalProcess);
      terminalProcess.kill();
    });
  }

  private async authenticate(token: string): Promise<{ id: number }> {
    const secret = await this.redisCacheService.getJwtSecret();
    const payload: any = jwt.verify(token, secret);
    const userId = Number(payload?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('终端鉴权失败');
    }
    return {
      id: userId,
    };
  }
}
