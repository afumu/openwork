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
  RuntimeWorkspaceCreateInput,
  RuntimeWorkspaceDeleteResult,
  RuntimeWorkspaceEntryMetadata,
  RuntimeWorkspaceManifest,
  RuntimeWorkspaceReadResult,
  RuntimeWorkspaceRenameResult,
  RuntimeWorkspaceSearchResult,
  RuntimeWorkspaceWriteInput,
  RuntimeStatusInput,
  RuntimeTerminalTarget,
} from './opensandboxRuntime.types';
import { buildRuntimeMetadata, resolveRuntimeWorkspace } from './runtimeWorkspace';

const WORKSPACE_JSON_PREFIX = 'OPENWORK_WORKSPACE_JSON:';
const WORKSPACE_MAX_FILES = 2000;
const WORKSPACE_MAX_READ_BYTES = 1024 * 1024;
const WORKSPACE_MAX_EDIT_BYTES = 1024 * 1024;
const WORKSPACE_MAX_WRITE_BYTES = 2 * 1024 * 1024;
const WORKSPACE_MAX_SEARCH_FILES = 200;
const WORKSPACE_MAX_SEARCH_MATCHES = 1000;
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

function normalizeWorkspaceRelativePath(pathValue: string, _workspaceRoot: string) {
  const normalized = String(pathValue || '')
    .trim()
    .replace(/\\/g, '/');

  if (!normalized || normalized.startsWith('/')) {
    throw new HttpException('文件路径不在工作区内', HttpStatus.BAD_REQUEST);
  }

  const relativePath = normalized.replace(/^\.\//, '').replace(/\/+/g, '/');
  const segments = relativePath.split('/');

  if (
    !relativePath ||
    relativePath === '.' ||
    relativePath.startsWith('/') ||
    segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new HttpException('文件路径不在工作区内', HttpStatus.BAD_REQUEST);
  }

  if (isHiddenOpenWorkPath(relativePath)) {
    throw new HttpException('不能访问 OpenWork 运行时内部状态文件', HttpStatus.FORBIDDEN);
  }

  return relativePath;
}

function isHiddenOpenWorkPath(relativePath: string) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
  return normalized === '.openwork' || normalized.startsWith('.openwork/');
}

function ensureTextPayloadLimit(content: string, maxBytes = WORKSPACE_MAX_WRITE_BYTES) {
  const size = Buffer.byteLength(String(content || ''), 'utf8');
  if (size > maxBytes) {
    throw new HttpException('文件内容超过大小限制', HttpStatus.PAYLOAD_TOO_LARGE);
  }
  if (String(content || '').includes('\u0000')) {
    throw new HttpException('不支持写入二进制文件内容', HttpStatus.BAD_REQUEST);
  }
  return size;
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
const ignored = new Set(['.git', 'node_modules', '.pnpm-store', '.cache', '.openwork']);
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
if (rel === '.openwork' || rel.startsWith('.openwork/')) {
  throw new Error('Path is hidden OpenWork runtime state');
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

function buildWorkspaceMutationHelpersScript() {
  return `
function detectType(filePath) {
  ${buildWorkspaceTypeDetectorScript()}
}
function assertVisibleRel(rel) {
  if (!rel || rel === '.openwork' || rel.startsWith('.openwork/')) {
    throw new Error('Path is hidden OpenWork runtime state');
  }
}
function assertInsideRoot(realRoot, target) {
  const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (target !== realRoot && !target.startsWith(realRootWithSep)) {
    throw new Error('Path escapes workspace');
  }
}
function assertWritableTargetInsideRoot(realRoot, target) {
  if (fs.existsSync(target)) {
    assertInsideRoot(realRoot, fs.realpathSync(target));
    return;
  }
  let parent = path.dirname(target);
  while (!fs.existsSync(parent)) {
    const nextParent = path.dirname(parent);
    if (nextParent === parent) break;
    parent = nextParent;
  }
  assertInsideRoot(realRoot, fs.realpathSync(parent));
}
function resolveTarget(root, rel, mustExist) {
  assertVisibleRel(rel);
  const target = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error('Path escapes workspace');
  }
  const realRoot = fs.realpathSync(root);
  if (mustExist) {
    assertInsideRoot(realRoot, fs.realpathSync(target));
  } else {
    assertWritableTargetInsideRoot(realRoot, target);
  }
  return target;
}
function metadata(root, rel) {
  const target = resolveTarget(root, rel, true);
  const stat = fs.statSync(target);
  return {
    kind: stat.isDirectory() ? 'directory' : 'file',
    name: path.basename(rel),
    path: rel.split(path.sep).join('/'),
    size: stat.size,
    type: stat.isDirectory() ? 'directory' : detectType(rel),
    updatedAt: stat.mtime.toISOString(),
    runId: null,
    source: 'workspace_root'
  };
}
function writeJson(payload) {
  console.log('${WORKSPACE_JSON_PREFIX}' + JSON.stringify(payload));
}
`;
}

function buildWriteWorkspaceFileScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const rel = String(process.argv[2] || '').replace(/^\\.\\/+/, '');
const content = Buffer.from(String(process.argv[3] || ''), 'base64').toString('utf8');
const maxBytes = Number(process.argv[4] || ${WORKSPACE_MAX_WRITE_BYTES});
${buildWorkspaceMutationHelpersScript()}
fs.mkdirSync(root, { recursive: true });
if (Buffer.byteLength(content, 'utf8') > maxBytes) {
  throw new Error('Payload too large');
}
if (content.includes('\\u0000')) {
  throw new Error('Binary content is not supported');
}
const target = resolveTarget(root, rel, false);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, content, 'utf8');
writeJson(metadata(root, rel));
`;
}

function buildCreateWorkspaceEntryScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const rel = String(process.argv[2] || '').replace(/^\\.\\/+/, '');
const kind = String(process.argv[3] || 'file') === 'directory' ? 'directory' : 'file';
const content = Buffer.from(String(process.argv[4] || ''), 'base64').toString('utf8');
const maxBytes = Number(process.argv[5] || ${WORKSPACE_MAX_WRITE_BYTES});
${buildWorkspaceMutationHelpersScript()}
fs.mkdirSync(root, { recursive: true });
const target = resolveTarget(root, rel, false);
if (fs.existsSync(target)) {
  throw new Error('Path already exists');
}
if (kind === 'directory') {
  fs.mkdirSync(target, { recursive: true });
} else {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error('Payload too large');
  }
  if (content.includes('\\u0000')) {
    throw new Error('Binary content is not supported');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
writeJson(metadata(root, rel));
`;
}

function buildRenameWorkspaceEntryScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const fromRel = String(process.argv[2] || '').replace(/^\\.\\/+/, '');
const toRel = String(process.argv[3] || '').replace(/^\\.\\/+/, '');
${buildWorkspaceMutationHelpersScript()}
fs.mkdirSync(root, { recursive: true });
const fromTarget = resolveTarget(root, fromRel, true);
const toTarget = resolveTarget(root, toRel, false);
if (fs.existsSync(toTarget)) {
  throw new Error('Destination already exists');
}
fs.mkdirSync(path.dirname(toTarget), { recursive: true });
fs.renameSync(fromTarget, toTarget);
writeJson({ fromPath: fromRel.split(path.sep).join('/'), toPath: toRel.split(path.sep).join('/'), entry: metadata(root, toRel) });
`;
}

function buildDeleteWorkspaceEntryScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const rel = String(process.argv[2] || '').replace(/^\\.\\/+/, '');
${buildWorkspaceMutationHelpersScript()}
fs.mkdirSync(root, { recursive: true });
const target = resolveTarget(root, rel, true);
const item = metadata(root, rel);
fs.rmSync(target, { recursive: true, force: false });
writeJson({ deleted: true, path: item.path, kind: item.kind, type: item.type, size: item.size, updatedAt: item.updatedAt });
`;
}

function buildSearchWorkspaceScript() {
  return `
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[1] || '/workspace');
const query = String(process.argv[2] || '');
const maxFiles = Number(process.argv[3] || ${WORKSPACE_MAX_SEARCH_FILES});
const maxMatches = Number(process.argv[4] || ${WORKSPACE_MAX_SEARCH_MATCHES});
const ignored = new Set(['.git', 'node_modules', '.pnpm-store', '.cache', '.openwork']);
const results = [];
let matchedFiles = 0;
let truncated = false;
function isText(buffer) {
  if (buffer.includes(0)) return false;
  return true;
}
function walk(dir) {
  if (truncated) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return; }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (truncated) return;
    if (ignored.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    let stat;
    try { stat = fs.lstatSync(abs); } catch (_error) { continue; }
    if (stat.isSymbolicLink()) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!rel || rel === '.openwork' || rel.startsWith('.openwork/')) continue;
    if (stat.isDirectory()) {
      walk(abs);
      continue;
    }
    if (!stat.isFile() || stat.size > ${WORKSPACE_MAX_EDIT_BYTES}) continue;
    let buffer;
    try { buffer = fs.readFileSync(abs); } catch (_error) { continue; }
    if (!isText(buffer)) continue;
    const text = buffer.toString('utf8');
    const lines = text.split(/\\r?\\n/g);
    const fileMatches = [];
    lines.forEach((line, index) => {
      if (fileMatches.length + results.reduce((sum, item) => sum + item.matches.length, 0) >= maxMatches) {
        truncated = true;
        return;
      }
      const column = query ? line.toLowerCase().indexOf(query.toLowerCase()) : -1;
      if (query && column >= 0) {
        fileMatches.push({ line: index + 1, column: column + 1, preview: line.slice(0, 500) });
      }
    });
    if (fileMatches.length > 0) {
      matchedFiles += 1;
      results.push({ path: rel, matches: fileMatches });
      if (matchedFiles >= maxFiles) truncated = true;
    }
  }
}
if (!query.trim()) {
  throw new Error('Missing search query');
}
fs.mkdirSync(root, { recursive: true });
walk(root);
console.log('${WORKSPACE_JSON_PREFIX}' + JSON.stringify({ results, truncated }));
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

  async writeWorkspaceFile(
    input: RuntimeStatusInput & RuntimeWorkspaceWriteInput,
  ): Promise<RuntimeWorkspaceEntryMetadata | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const relativePath = normalizeWorkspaceRelativePath(
      input.path,
      runtime.descriptor.workspaceRoot,
    );
    ensureTextPayloadLimit(input.content);

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceEntryMetadata>(
      runtime.sandbox,
      buildWriteWorkspaceFileScript(),
      [
        runtime.descriptor.workspaceRoot,
        relativePath,
        Buffer.from(input.content || '', 'utf8').toString('base64'),
        String(WORKSPACE_MAX_WRITE_BYTES),
      ],
      15,
    );
  }

  async createWorkspaceEntry(
    input: RuntimeStatusInput & RuntimeWorkspaceCreateInput,
  ): Promise<RuntimeWorkspaceEntryMetadata | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const relativePath = normalizeWorkspaceRelativePath(
      input.path,
      runtime.descriptor.workspaceRoot,
    );
    const kind = input.kind === 'directory' ? 'directory' : 'file';
    const content = input.content || '';
    if (kind === 'file') {
      ensureTextPayloadLimit(content);
    }

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceEntryMetadata>(
      runtime.sandbox,
      buildCreateWorkspaceEntryScript(),
      [
        runtime.descriptor.workspaceRoot,
        relativePath,
        kind,
        Buffer.from(content, 'utf8').toString('base64'),
        String(WORKSPACE_MAX_WRITE_BYTES),
      ],
      15,
    );
  }

  async renameWorkspaceEntry(
    input: RuntimeStatusInput & { fromPath: string; toPath: string },
  ): Promise<RuntimeWorkspaceRenameResult | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const fromPath = normalizeWorkspaceRelativePath(input.fromPath, runtime.descriptor.workspaceRoot);
    const toPath = normalizeWorkspaceRelativePath(input.toPath, runtime.descriptor.workspaceRoot);

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceRenameResult>(
      runtime.sandbox,
      buildRenameWorkspaceEntryScript(),
      [runtime.descriptor.workspaceRoot, fromPath, toPath],
      15,
    );
  }

  async deleteWorkspaceEntry(
    input: RuntimeStatusInput & { path: string },
  ): Promise<RuntimeWorkspaceDeleteResult | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const relativePath = normalizeWorkspaceRelativePath(input.path, runtime.descriptor.workspaceRoot);

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceDeleteResult>(
      runtime.sandbox,
      buildDeleteWorkspaceEntryScript(),
      [runtime.descriptor.workspaceRoot, relativePath],
      15,
    );
  }

  async searchWorkspace(
    input: RuntimeStatusInput & { query: string },
  ): Promise<RuntimeWorkspaceSearchResult | null> {
    const runtime = await this.connectExistingRuntime(input);
    if (!runtime) return null;

    const query = String(input.query || '').trim();
    if (!query) {
      throw new HttpException('缺少搜索关键词', HttpStatus.BAD_REQUEST);
    }

    return this.runWorkspaceNodeCommand<RuntimeWorkspaceSearchResult>(
      runtime.sandbox,
      buildSearchWorkspaceScript(),
      [
        runtime.descriptor.workspaceRoot,
        query,
        String(WORKSPACE_MAX_SEARCH_FILES),
        String(WORKSPACE_MAX_SEARCH_MATCHES),
      ],
      20,
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
