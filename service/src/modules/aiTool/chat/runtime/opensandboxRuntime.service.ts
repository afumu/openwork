import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { OpenSandboxClientService, readOpenSandboxRuntimeConfig } from './opensandboxClient';
import type {
  EnsureRuntimeInput,
  OpenSandboxClient,
  OpenSandboxRuntimeConfig,
  OpenSandboxSandbox,
  OpenSandboxVolume,
  OpenWorkProjectStatus,
  RuntimeDescriptor,
  RuntimeWorkspaceManifest,
  RuntimeWorkspaceReadResult,
  RuntimeStatusInput,
  RuntimeTerminalTarget,
} from './opensandboxRuntime.types';
import { buildRuntimeMetadata, resolveRuntimeWorkspace } from './runtimeWorkspace';

const WORKSPACE_JSON_PREFIX = 'OPENWORK_WORKSPACE_JSON:';
const WORKSPACE_MAX_FILES = 2000;
const WORKSPACE_MAX_READ_BYTES = 1024 * 1024;
const TERMINAL_SHELL = '/bin/bash';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function getBridgeUrl(descriptor: RuntimeDescriptor, path: string) {
  return `${stripTrailingSlash(descriptor.baseUrl)}/${path.replace(/^\/+/g, '')}`;
}

function sanitizeEnv(env: Record<string, string | undefined>) {
  return Object.entries(env).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      acc[key] = String(value);
    }
    return acc;
  }, {});
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildEnvSignature(env: Record<string, string>) {
  return createHash('sha256').update(JSON.stringify(env)).digest('hex');
}

function buildStableHash(value: unknown, length = 8) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function sanitizeDnsLabelSegment(value: string, fallback: string) {
  const sanitized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

function sanitizeMetadataValue(value: string, fallback: string) {
  return sanitizeDnsLabelSegment(value, fallback).slice(0, 63).replace(/-+$/g, '') || fallback;
}

function buildWorkspaceVolumeName(input: {
  groupId: number | string;
  prefix: string;
  userId: number;
}) {
  const hash = buildStableHash(
    {
      groupId: String(input.groupId),
      userId: String(input.userId),
    },
    8,
  );
  const prefix = sanitizeDnsLabelSegment(input.prefix, 'openwork-ws');
  const user = sanitizeDnsLabelSegment(`u${input.userId}`, 'u0');
  const group = sanitizeDnsLabelSegment(`g${String(input.groupId)}`, 'g0');
  const base = `${prefix}-${user}-${group}`;
  const maxBaseLength = 63 - hash.length - 1;
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, '') || 'openwork-ws';
  return `${trimmedBase}-${hash}`;
}

function stripEmptyObjectValues<T extends Record<string, unknown>>(value: T) {
  return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, item]) => {
    if (item !== undefined && item !== null && item !== '') {
      acc[key] = item;
    }
    return acc;
  }, {}) as T;
}

function buildWorkspaceMountPlan(input: {
  config: OpenSandboxRuntimeConfig;
  groupId: number | string;
  userId: number;
  workspaceRoot: string;
}) {
  const baseMetadata: Record<string, string> = {
    workspaceBackend: input.config.workspaceBackend,
    workspaceRoot: sanitizeMetadataValue(input.workspaceRoot, 'workspace'),
    workspaceScope: 'conversation',
  };

  if (input.config.workspaceBackend !== 'volume') {
    return {
      metadata: {
        ...baseMetadata,
        workspaceSignature: buildStableHash(baseMetadata, 12),
      },
      volumes: undefined,
    };
  }

  const volumeName = buildWorkspaceVolumeName({
    groupId: input.groupId,
    prefix: input.config.workspaceVolumePrefix,
    userId: input.userId,
  });
  const pvc = stripEmptyObjectValues({
    claimName: volumeName,
    createIfNotExists: true,
    deleteOnSandboxTermination: input.config.workspaceVolumeDeleteOnSandboxTermination,
    storage: input.config.workspaceVolumeSize,
    storageClass: input.config.workspaceVolumeStorageClass,
  });
  const volumes: OpenSandboxVolume[] = [
    {
      mountPath: input.workspaceRoot,
      name: 'workspace',
      pvc,
      readOnly: false,
    },
  ];
  const metadata = {
    ...baseMetadata,
    workspaceVolumeName: volumeName,
    workspaceSignature: buildStableHash({ ...baseMetadata, volumeName, pvc }, 12),
  };

  return { metadata, volumes };
}

function commandOutputToString(log?: any[] | string) {
  if (Array.isArray(log)) {
    return log
      .map(item => {
        if (typeof item === 'string') return item;
        if (item?.text !== undefined) return String(item.text);
        if (item?.content !== undefined) return String(item.content);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return log || '';
}

function parseWorkspaceCommandJson<T>(stdout: string): T {
  const line = stdout
    .split(/\r?\n/g)
    .reverse()
    .find(item => item.startsWith(WORKSPACE_JSON_PREFIX));

  if (!line) {
    throw new HttpException('OpenSandbox 工作区命令未返回有效数据', HttpStatus.BAD_GATEWAY);
  }

  try {
    return JSON.parse(line.slice(WORKSPACE_JSON_PREFIX.length)) as T;
  } catch (error) {
    throw new HttpException(
      `OpenSandbox 工作区返回解析失败: ${error instanceof Error ? error.message : String(error)}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}

function normalizeWorkspaceRelativePath(pathValue: string, workspaceRoot: string) {
  const normalized = String(pathValue || '')
    .trim()
    .replace(/\\/g, '/');
  const root = stripTrailingSlash(workspaceRoot);
  const relativePath =
    normalized === root
      ? ''
      : normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized.replace(/^\.?\//, '');

  if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new HttpException('文件路径不在工作区内', HttpStatus.BAD_REQUEST);
  }

  return relativePath;
}

function normalizeModelApiFormat(apiFormat?: string) {
  const normalized = String(apiFormat || 'openai')
    .trim()
    .toLowerCase();

  if (normalized === 'anthropic' || normalized === 'opensandbox') return 'anthropic';
  return 'openai';
}

function buildModelRuntimeEnv(input: EnsureRuntimeInput) {
  const apiFormat = normalizeModelApiFormat(input.apiFormat);
  const baseEnv = sanitizeEnv({
    OPENWORK_MODEL_API_FORMAT: apiFormat,
    OPENWORK_MODEL_API_KEY: input.apiKey,
    OPENWORK_MODEL_BASE_URL: input.apiBaseUrl,
    OPENWORK_MODEL_NAME: input.model,
  });

  if (apiFormat === 'anthropic') {
    return {
      ...baseEnv,
      ...sanitizeEnv({
        ANTHROPIC_AUTH_TOKEN: input.apiKey,
        ANTHROPIC_BASE_URL: input.apiBaseUrl,
        ANTHROPIC_MODEL: input.model,
      }),
    };
  }

  return {
    ...baseEnv,
    ...sanitizeEnv({
      OPENAI_API_KEY: input.apiKey,
      OPENAI_BASE_URL: input.apiBaseUrl,
      OPENAI_MODEL: input.model,
    }),
  };
}

function buildWorkspaceTypeDetectorScript() {
  return `
const ext = filePath.split('?')[0].split('/').pop().toLowerCase().split('.').pop() || '';
const mime = {
  css: 'css',
  gif: 'image/gif',
  htm: 'html',
  html: 'html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  png: 'image/png',
  py: 'python',
  svg: 'image/svg+xml',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'text',
  vue: 'vue',
  webp: 'image/webp',
  yaml: 'yaml',
  yml: 'yaml'
};
return mime[ext] || 'text';
`;
}

function buildListWorkspaceScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const maxFiles = Number(process.argv[2] || ${WORKSPACE_MAX_FILES});
const ignored = new Set(['.git', 'node_modules', '.pnpm-store', '.cache']);
const files = [];
function detectType(filePath) {
  ${buildWorkspaceTypeDetectorScript()}
}
function pushFile(abs, rel, stat) {
  files.push({
    name: path.basename(rel),
    path: rel.split(path.sep).join('/'),
    size: stat.size,
    type: detectType(rel),
    updatedAt: stat.mtime.toISOString(),
    runId: null,
    source: 'workspace_root'
  });
}
function walk(dir) {
  if (files.length >= maxFiles) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    if (ignored.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch (_error) {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    const rel = path.relative(root, abs);
    if (!rel) continue;
    if (stat.isDirectory()) {
      walk(abs);
    } else if (stat.isFile()) {
      pushFile(abs, rel, stat);
    }
  }
}
fs.mkdirSync(root, { recursive: true });
walk(root);
console.log('${WORKSPACE_JSON_PREFIX}' + JSON.stringify({
  truncated: files.length >= maxFiles,
  workspaceFiles: files
}));
`;
}

function buildReadWorkspaceFileScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const rel = String(process.argv[2] || '').replace(/^\\.?\\/+/, '');
const maxBytes = Number(process.argv[3] || ${WORKSPACE_MAX_READ_BYTES});
function detectType(filePath) {
  ${buildWorkspaceTypeDetectorScript()}
}
const target = path.resolve(root, rel);
const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
if (!rel || (target !== root && !target.startsWith(rootWithSep))) {
  throw new Error('Path escapes workspace');
}
const realRoot = fs.realpathSync(root);
const realTarget = fs.realpathSync(target);
const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
if (realTarget !== realRoot && !realTarget.startsWith(realRootWithSep)) {
  throw new Error('Path escapes workspace');
}
const stat = fs.statSync(target);
if (!stat.isFile()) {
  throw new Error('Path is not a file');
}
const buffer = fs.readFileSync(target);
const truncated = buffer.length > maxBytes;
const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
const type = detectType(rel);
const content = type.startsWith('image/') ? slice.toString('base64') : slice.toString('utf8');
console.log('${WORKSPACE_JSON_PREFIX}' + JSON.stringify({
  content,
  path: rel.split(path.sep).join('/'),
  run_id: null,
  size: stat.size,
  truncated,
  type,
  updatedAt: stat.mtime.toISOString()
}));
`;
}

function buildOpenWorkProjectStatusScript() {
  return `
const childProcess = require('child_process');
const root = process.argv[1] || '/workspace';
function parseJsonOutput(output) {
  try {
    return JSON.parse(String(output || '').trim());
  } catch (_error) {
    return null;
  }
}
let payload = null;
try {
  const stdout = childProcess.execFileSync('openwork', ['status', '--workspace', root, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  payload = parseJsonOutput(stdout);
} catch (error) {
  payload = parseJsonOutput(error?.stdout) || {
    ok: false,
    error: error?.message || 'openwork status failed'
  };
}
console.log('${WORKSPACE_JSON_PREFIX}' + JSON.stringify(payload));
`;
}

@Injectable()
export class OpenSandboxRuntimeService {
  private readonly logger = new Logger(OpenSandboxRuntimeService.name);

  constructor(
    @Optional()
    @Inject(OpenSandboxClientService)
    private readonly client: OpenSandboxClient = new OpenSandboxClientService(),
  ) {}

  private getConfig(): OpenSandboxRuntimeConfig {
    return readOpenSandboxRuntimeConfig();
  }

  async ensureRuntime(input: EnsureRuntimeInput): Promise<RuntimeDescriptor> {
    const config = this.getConfig();
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
    });
    const workspaceMount = buildWorkspaceMountPlan({
      config,
      groupId: input.groupId,
      userId: input.userId,
      workspaceRoot: workspace.workspaceRoot,
    });
    const metadata = buildRuntimeMetadata({
      groupId: input.groupId,
      userId: input.userId,
      workspace: workspaceMount.metadata,
    });
    const existing = await this.client.findSandboxByMetadata(metadata);
    const modelEnv = buildModelRuntimeEnv(input);
    const sandbox = existing
      ? await this.client.connectSandbox(existing.id)
      : await this.client.createSandbox({
          env: sanitizeEnv({
            ...modelEnv,
            CLAUDE_ALLOWED_TOOLS:
              process.env.CLAUDE_ALLOWED_TOOLS || 'Bash,Read,Write,Edit,Glob,Grep,LS',
            CLAUDE_BRIDGE_CWD: workspace.workspacePath,
            CLAUDE_BRIDGE_PORT: String(config.bridgePort),
            CLAUDE_PERMISSION_MODE: process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions',
            OPENWORK_WORKSPACE_ROOT: workspace.workspaceRoot,
            IS_SANDBOX: '1',
          }),
          image: config.image,
          metadata,
          volumes: workspaceMount.volumes,
          resource: {
            cpu: config.cpu || '2',
            memory: config.memory || '4Gi',
          },
          timeoutSeconds: config.timeoutSeconds,
        });

    if (existing) {
      await sandbox.renew?.(config.timeoutSeconds).catch(error => {
        this.logger.warn(
          `[traceId=${input.traceId || '-'}] OpenSandbox sandbox 续期失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    await this.ensureBridgeProcess(sandbox, workspace.workspacePath, config, input);

    const descriptor = await this.buildDescriptor(sandbox, input, config);
    await this.checkBridgeHealth(descriptor, input.traceId);
    return descriptor;
  }

  async getRuntimeStatus(input: RuntimeStatusInput): Promise<RuntimeDescriptor | null> {
    const config = this.getConfig();
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
    });
    const workspaceMount = buildWorkspaceMountPlan({
      config,
      groupId: input.groupId,
      userId: input.userId,
      workspaceRoot: workspace.workspaceRoot,
    });
    const metadata = buildRuntimeMetadata({
      groupId: input.groupId,
      userId: input.userId,
      workspace: workspaceMount.metadata,
    });
    const existing = await this.client.findSandboxByMetadata(metadata);

    if (!existing) {
      return null;
    }

    const sandbox = await this.client.connectSandbox(existing.id);
    return this.buildDescriptor(sandbox, input, config);
  }

  async getRuntimeTerminalTarget(input: RuntimeStatusInput): Promise<RuntimeTerminalTarget | null> {
    const config = this.getConfig();
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
    });
    const workspaceMount = buildWorkspaceMountPlan({
      config,
      groupId: input.groupId,
      userId: input.userId,
      workspaceRoot: workspace.workspaceRoot,
    });
    const metadata = buildRuntimeMetadata({
      groupId: input.groupId,
      userId: input.userId,
      workspace: workspaceMount.metadata,
    });
    const existing = await this.client.findSandboxByMetadata(metadata);

    if (!existing) {
      return null;
    }

    const sandbox = await this.client.connectSandbox(existing.id);
    const endpoint = await sandbox.getEndpoint(config.execdPort);
    const protocol = sandbox.connectionConfig?.protocol || 'http';

    return {
      endpointHeaders: endpoint.headers || {},
      execdBaseUrl: `${protocol}://${stripTrailingSlash(endpoint.endpoint)}`,
      groupId: input.groupId,
      mode: 'opensandbox',
      sandboxId: sandbox.id,
      shell: TERMINAL_SHELL,
      userId: input.userId,
      workspacePath: workspace.workspacePath,
    };
  }

  async listWorkspaceFiles(input: RuntimeStatusInput): Promise<RuntimeWorkspaceManifest | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const payload = await this.runWorkspaceNodeCommand<{
      truncated?: boolean;
      workspaceFiles?: RuntimeWorkspaceManifest['workspaceFiles'];
    }>(
      runtime.sandbox,
      buildListWorkspaceScript(),
      [runtime.descriptor.workspaceRoot, String(WORKSPACE_MAX_FILES)],
      15,
    );

    return {
      truncated: Boolean(payload.truncated),
      workspaceDir: runtime.descriptor.workspaceDir,
      workspaceFiles: payload.workspaceFiles || [],
      workspaceRoot: runtime.descriptor.workspaceRoot,
      workspaceRootMode: 'conversation',
    };
  }

  async readWorkspaceFile(
    input: RuntimeStatusInput & { path: string },
  ): Promise<RuntimeWorkspaceReadResult | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const relativePath = normalizeWorkspaceRelativePath(
      input.path,
      runtime.descriptor.workspaceRoot,
    );

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceReadResult>(
      runtime.sandbox,
      buildReadWorkspaceFileScript(),
      [runtime.descriptor.workspaceRoot, relativePath, String(WORKSPACE_MAX_READ_BYTES)],
      15,
    );
  }

  async getOpenWorkProjectStatus(
    input: RuntimeStatusInput,
  ): Promise<OpenWorkProjectStatus | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    return this.runWorkspaceNodeCommand<OpenWorkProjectStatus>(
      runtime.sandbox,
      buildOpenWorkProjectStatusScript(),
      [runtime.descriptor.workspaceRoot],
      15,
    );
  }

  async stopAgent(descriptor: RuntimeDescriptor) {
    await fetch(getBridgeUrl(descriptor, 'stop'), {
      headers: descriptor.endpointHeaders,
      method: 'POST',
    }).catch(() => undefined);
  }

  private async buildDescriptor(
    sandbox: OpenSandboxSandbox,
    input: RuntimeStatusInput,
    config: OpenSandboxRuntimeConfig,
  ): Promise<RuntimeDescriptor> {
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
    });
    const endpoint = await sandbox.getEndpoint(config.bridgePort);
    const info = await sandbox.getInfo().catch(() => null);
    const protocol = sandbox.connectionConfig?.protocol || 'http';

    return {
      baseUrl: `${protocol}://${stripTrailingSlash(endpoint.endpoint)}`,
      endpointHeaders: endpoint.headers || {},
      groupId: input.groupId,
      mode: 'opensandbox',
      sandboxId: sandbox.id,
      status: info?.status?.state,
      userId: input.userId,
      workspaceDir: workspace.workspaceDir,
      workspaceRoot: workspace.workspaceRoot,
    };
  }

  private async connectExistingRuntime(input: RuntimeStatusInput) {
    const config = this.getConfig();
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
    });
    const workspaceMount = buildWorkspaceMountPlan({
      config,
      groupId: input.groupId,
      userId: input.userId,
      workspaceRoot: workspace.workspaceRoot,
    });
    const metadata = buildRuntimeMetadata({
      groupId: input.groupId,
      userId: input.userId,
      workspace: workspaceMount.metadata,
    });
    const existing = await this.client.findSandboxByMetadata(metadata);

    if (!existing) {
      return null;
    }

    const sandbox = await this.client.connectSandbox(existing.id);
    const descriptor = await this.buildDescriptor(sandbox, input, config);
    return { descriptor, sandbox };
  }

  private async runWorkspaceNodeCommand<T>(
    sandbox: OpenSandboxSandbox,
    script: string,
    args: string[],
    timeoutSeconds: number,
  ): Promise<T> {
    if (!sandbox.commands?.run) {
      throw new HttpException(
        'OpenSandbox sandbox 不支持工作区文件命令',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const command = [`node -e ${shellQuote(script)}`, ...args.map(shellQuote)].join(' ');
    const result = await sandbox.commands.run(command, {
      timeoutSeconds,
      workingDirectory: '/',
    });
    const stderr = commandOutputToString(result?.logs?.stderr);

    if (result?.error || result?.exitCode) {
      throw new HttpException(
        `OpenSandbox 工作区命令失败: ${result.error || stderr || `exitCode=${result.exitCode}`}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const stdout = commandOutputToString(result?.logs?.stdout);
    const output = stdout || commandOutputToString(result?.result);
    return parseWorkspaceCommandJson<T>(output);
  }

  private async ensureBridgeProcess(
    sandbox: OpenSandboxSandbox,
    workspacePath: string,
    config: OpenSandboxRuntimeConfig,
    input: EnsureRuntimeInput,
  ) {
    if (!sandbox.commands?.run) {
      this.logger.warn(
        `[traceId=${
          input.traceId || '-'
        }] OpenSandbox sandbox 不支持 commands.run，跳过 bridge 启动命令`,
      );
      return;
    }

    const bridgeFile = '/opt/openwork-agent-bridge/bridge.mjs';
    const logFile = '/tmp/openwork-agent-bridge.log';
    const signatureFile = '/tmp/openwork-agent-bridge.env.sha256';
    const healthUrl = `http://127.0.0.1:${config.bridgePort}/health`;
    const modelEnv = buildModelRuntimeEnv(input);
    const bridgeEnv = sanitizeEnv({
      ...modelEnv,
      CLAUDE_ALLOWED_TOOLS: process.env.CLAUDE_ALLOWED_TOOLS || 'Bash,Read,Write,Edit,Glob,Grep,LS',
      CLAUDE_BRIDGE_CWD: workspacePath,
      CLAUDE_BRIDGE_PORT: String(config.bridgePort),
      CLAUDE_PERMISSION_MODE: process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions',
      IS_SANDBOX: '1',
      OPENWORK_WORKSPACE_ROOT: config.workspaceRoot,
    });
    const envSignature = buildEnvSignature(bridgeEnv);
    const command = [
      `mkdir -p ${shellQuote(workspacePath)}`,
      [
        `if curl -fsS --max-time 2 ${shellQuote(
          healthUrl,
        )} >/dev/null 2>&1 && test "$(cat ${shellQuote(signatureFile)} 2>/dev/null)" = ${shellQuote(
          envSignature,
        )}; then`,
        `echo "openwork-agent-bridge already running";`,
        `else`,
        `pids=$(ps -eo pid,args | awk '$2 == "node" && $3 == ${shellQuote(
          bridgeFile,
        )} { print $1 }');`,
        `if test -n "$pids"; then kill $pids >/dev/null 2>&1 || true; fi;`,
        `printf %s ${shellQuote(envSignature)} > ${shellQuote(signatureFile)};`,
        `nohup node ${shellQuote(bridgeFile)} > ${shellQuote(logFile)} 2>&1 &`,
        `echo "openwork-agent-bridge started";`,
        `fi`,
      ].join(' '),
    ].join(' && ');

    const result = await sandbox.commands.run(command, {
      envs: bridgeEnv,
      timeoutSeconds: 10,
      workingDirectory: '/opt/openwork-agent-bridge',
    });

    if (result?.error || result?.exitCode) {
      const stderr = commandOutputToString(result.logs?.stderr);
      throw new HttpException(
        `OpenSandbox bridge 启动失败: ${result.error || stderr || `exitCode=${result.exitCode}`}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async checkBridgeHealth(descriptor: RuntimeDescriptor, traceId?: string) {
    let lastError = 'not attempted';

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(getBridgeUrl(descriptor, 'health'), {
          headers: descriptor.endpointHeaders,
        });
        if (response.ok) {
          const body = await response.json().catch(() => null);
          if (body?.ok === true) {
            return;
          }
          lastError = `health returned ${JSON.stringify(body)}`;
        } else {
          lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt === 0 || attempt === 4 || attempt === 19 || attempt === 59) {
        this.logger.debug(
          `[traceId=${traceId || '-'}] 等待 OpenSandbox bridge 健康检查 ${
            attempt + 1
          }/60: ${lastError}`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new HttpException(
      `OpenSandbox bridge 未就绪: ${lastError}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
