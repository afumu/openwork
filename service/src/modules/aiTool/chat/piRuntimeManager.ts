import { serializeErrorForLog } from '../../../common/utils';
import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { deriveInternalSearchToken } from '../search/internalSearchAuth';
import { RedisCacheService } from '../../redisCache/redisCache.service';
import { promises as fs } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PI_RUNTIME_CONTAINER_PORT = 8787;
const RUNTIME_CWD_MARKER = '__OPENWORK_RUNTIME_CWD__:';

type DockerInspectPortBinding = {
  HostIp?: string;
  HostPort?: string;
};

type DockerInspectResult = {
  Id?: string;
  Name?: string;
  Config?: {
    Env?: string[];
  };
  Mounts?: Array<{
    Type?: string;
    Source?: string;
    Destination?: string;
    Name?: string;
    RW?: boolean;
  }>;
  State?: {
    Running?: boolean;
    Status?: string;
  };
  NetworkSettings?: {
    Ports?: Record<string, DockerInspectPortBinding[] | null>;
  };
};

export type PiRuntimeDescriptor = {
  baseUrl: string;
  containerId?: string;
  containerName?: string;
  groupId?: number | string;
  hostPort?: number;
  mode: 'docker' | 'direct';
  running?: boolean;
  status?: string;
  userId?: number;
  volumeName?: string;
};

export type PiRuntimeScope = {
  groupId: number | string;
  userId: number;
};

export type RuntimeCommandResult = {
  code: number;
  command: string;
  containerName: string;
  cwd: string;
  mode: 'docker';
  stderr: string;
  stdout: string;
  timedOut?: boolean;
};

function normalizeRuntimeGroupId(groupId: number | string) {
  if (typeof groupId === 'number') {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('非法的对话分组 ID');
    }
    return String(groupId);
  }

  const normalized = String(groupId || '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new Error('非法的对话分组 ID');
  }

  return normalized;
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildPiRuntimeNames(scope: PiRuntimeScope) {
  const groupId = normalizeRuntimeGroupId(scope.groupId);
  return {
    containerName: `openwork-user-${scope.userId}-group-${groupId}`,
    volumeName: `openwork-user-${scope.userId}-group-${groupId}-workspace`,
  };
}

export function extractPublishedPort(inspectResult: DockerInspectResult) {
  const portBindings = inspectResult?.NetworkSettings?.Ports?.[`${PI_RUNTIME_CONTAINER_PORT}/tcp`];
  const published = portBindings?.[0]?.HostPort;
  if (!published) {
    return null;
  }

  const parsed = Number(published);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasRuntimeBundleMount(inspectResult: DockerInspectResult, mountPath: string) {
  return Boolean(inspectResult.Mounts?.some(mount => mount.Destination === mountPath));
}

function hasRuntimeBundleEnv(inspectResult: DockerInspectResult) {
  return Boolean(inspectResult.Config?.Env?.some(env => env.startsWith('PI_RUNTIME_BUNDLE_DIR=')));
}

function hasInternalSearchEnv(inspectResult: DockerInspectResult) {
  const envList = inspectResult.Config?.Env || [];
  return (
    envList.some(env => env.startsWith('OPENWORK_INTERNAL_SEARCH_URL=')) &&
    envList.some(env => env.startsWith('OPENWORK_INTERNAL_SEARCH_TOKEN='))
  );
}

export function resolveConversationWorkspace(groupId: number) {
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error('非法的对话分组 ID');
  }

  return `conversations/${groupId}`;
}

export function resolveRuntimeWorkspacePath(workspaceRoot: string, workspaceDir: string) {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, '');
  const normalizedDir = workspaceDir.replace(/^\/+/, '');
  return `${normalizedRoot}/${normalizedDir}`;
}

export function unwrapRuntimeCommandStdout(stdout: string, fallbackCwd: string) {
  const markerIndex = stdout.lastIndexOf(`\n${RUNTIME_CWD_MARKER}`);
  const startsWithMarker = stdout.startsWith(RUNTIME_CWD_MARKER);

  if (markerIndex === -1 && !startsWithMarker) {
    return { cwd: fallbackCwd, stdout };
  }

  const markerStart = startsWithMarker ? 0 : markerIndex + 1;
  const output = stdout.slice(0, startsWithMarker ? 0 : markerIndex);
  const markerLine = stdout.slice(markerStart).split(/\r?\n/)[0] || '';
  const nextCwd = markerLine.slice(RUNTIME_CWD_MARKER.length).trim();

  return {
    cwd: nextCwd || fallbackCwd,
    stdout: output,
  };
}

export function resolveRuntimeBundleHostPath(
  explicitPath?: string,
  homeDir = process.env.HOME || '',
  platform = process.platform,
) {
  if (explicitPath?.trim()) {
    return resolvePath(explicitPath.trim());
  }

  if (homeDir.trim()) {
    return resolvePath(homeDir, '.openwork', 'runtime-bundles');
  }

  return '/opt/openwork/runtime-bundles';
}

export function resolveDockerToolsMode(dockerTools?: string, openAiTools?: string) {
  return dockerTools?.trim() || openAiTools?.trim() || 'coding';
}

export function resolveRuntimeBootstrapAgentFiles() {
  return ['settings.json'];
}

@Injectable()
export class PiRuntimeManagerService {
  constructor(private readonly redisCacheService: RedisCacheService) {}

  private readonly pendingRuntimeEnsures = new Map<string, Promise<PiRuntimeDescriptor>>();

  private readonly directGatewayBaseUrl =
    process.env.PI_GATEWAY_BASE_URL || 'http://127.0.0.1:8787';
  private readonly dockerEnabled = process.env.PI_DOCKER_ENABLED === '1';
  private readonly dockerBinary = process.env.PI_DOCKER_BINARY || 'docker';
  private readonly dockerHost = process.env.PI_DOCKER_HOST || '127.0.0.1';
  private readonly dockerImage = process.env.PI_DOCKER_IMAGE || 'openwork-runtime:latest';
  private readonly dockerAgentDir = process.env.PI_DOCKER_AGENT_DIR || '/workspace/.pi';
  private readonly dockerToolsMode = resolveDockerToolsMode(
    process.env.PI_DOCKER_TOOLS,
    process.env.PI_OPENAI_TOOLS,
  );
  private readonly dockerMemory = process.env.PI_DOCKER_MEMORY || '4g';
  private readonly dockerCpus = process.env.PI_DOCKER_CPUS || '2';
  private readonly dockerPidsLimit = process.env.PI_DOCKER_PIDS_LIMIT || '512';
  private readonly healthPath = process.env.PI_DOCKER_HEALTH_PATH || '/healthz';
  private readonly waitReadyTimeoutMs = Number(process.env.PI_DOCKER_READY_TIMEOUT_MS || '30000');
  private readonly workspaceVolumePath = process.env.PI_DOCKER_WORKSPACE_PATH || '/workspace';
  private readonly dockerRuntimeBundleHostPath = resolveRuntimeBundleHostPath(
    process.env.PI_DOCKER_RUNTIME_BUNDLE_HOST_PATH,
  );
  private readonly dockerRuntimeBundleMountPath =
    process.env.PI_DOCKER_RUNTIME_BUNDLE_MOUNT_PATH || '/mnt/pi-runtime-bundles';
  private readonly dockerRuntimeVersion = process.env.PI_DOCKER_RUNTIME_VERSION?.trim() || '';
  private readonly dockerBootstrapAgentDir =
    process.env.PI_DOCKER_BOOTSTRAP_AGENT_DIR || join(process.env.HOME || '', '.pi', 'agent');
  private readonly dockerBootstrapHostAlias =
    process.env.PI_DOCKER_BOOTSTRAP_HOST_ALIAS || 'host.docker.internal';
  private readonly internalSearchServicePort = process.env.PORT || '9527';
  private readonly internalSearchPath =
    process.env.PI_INTERNAL_SEARCH_PATH || '/api/openwork/internal/search';
  private readonly internalModelProxyPath =
    process.env.PI_INTERNAL_MODEL_PROXY_PATH || '/api/openwork/internal/model-proxy/v1';

  isDockerEnabled() {
    return this.dockerEnabled;
  }

  getDirectGatewayBaseUrl() {
    return this.directGatewayBaseUrl.replace(/\/+$/, '');
  }

  resolveInternalModelProxyBaseUrl() {
    const host = this.dockerEnabled ? this.dockerBootstrapHostAlias : '127.0.0.1';
    return `http://${host}:${this.internalSearchServicePort}${this.internalModelProxyPath}`;
  }

  async ensureRuntime(scope: PiRuntimeScope, traceId?: string): Promise<PiRuntimeDescriptor> {
    if (!this.dockerEnabled) {
      return {
        baseUrl: this.getDirectGatewayBaseUrl(),
        mode: 'direct',
      };
    }

    const { containerName, volumeName } = buildPiRuntimeNames(scope);
    const pendingEnsure = this.pendingRuntimeEnsures.get(containerName);
    if (pendingEnsure) {
      return pendingEnsure;
    }

    const ensurePromise = this.ensureDockerRuntime(
      scope,
      containerName,
      volumeName,
      traceId,
    ).finally(() => {
      this.pendingRuntimeEnsures.delete(containerName);
    });
    this.pendingRuntimeEnsures.set(containerName, ensurePromise);
    return ensurePromise;
  }

  private async ensureDockerRuntime(
    scope: PiRuntimeScope,
    containerName: string,
    volumeName: string,
    traceId?: string,
  ): Promise<PiRuntimeDescriptor> {
    let inspectResult = await this.inspectContainer(containerName);

    if (
      inspectResult &&
      (!hasRuntimeBundleMount(inspectResult, this.dockerRuntimeBundleMountPath) ||
        !hasRuntimeBundleEnv(inspectResult) ||
        !hasInternalSearchEnv(inspectResult))
    ) {
      await this.runDocker(['rm', '-f', containerName], traceId).catch(() => undefined);
      inspectResult = null;
    }

    if (!inspectResult) {
      await this.createRuntime(scope, traceId);
      inspectResult = await this.inspectContainer(containerName);
    }

    if (!inspectResult) {
      throw new Error(`PI runtime 容器创建失败: ${containerName}`);
    }

    if (!inspectResult.State?.Running) {
      await this.runDocker(['start', containerName], traceId);
      inspectResult = await this.inspectContainer(containerName);
    }

    const hostPort = inspectResult ? extractPublishedPort(inspectResult) : null;
    if (!hostPort) {
      throw new Error(`PI runtime 容器未暴露可访问端口: ${containerName}`);
    }

    const descriptor: PiRuntimeDescriptor = {
      baseUrl: `http://${this.dockerHost}:${hostPort}`,
      containerId: inspectResult.Id,
      containerName,
      groupId: scope.groupId,
      hostPort,
      mode: 'docker',
      running: Boolean(inspectResult.State?.Running),
      status: inspectResult.State?.Status,
      userId: scope.userId,
      volumeName,
    };

    await this.sanitizeRuntimeAgentSecrets(containerName, traceId);
    await this.waitUntilHealthy(descriptor, traceId);
    return descriptor;
  }

  async findRuntime(scope: PiRuntimeScope, startIfStopped = false, traceId?: string) {
    if (!this.dockerEnabled) {
      return {
        baseUrl: this.getDirectGatewayBaseUrl(),
        mode: 'direct' as const,
      };
    }

    const { containerName, volumeName } = buildPiRuntimeNames(scope);
    let inspectResult = await this.inspectContainer(containerName);
    if (!inspectResult) {
      return null;
    }

    if (!inspectResult.State?.Running) {
      if (!startIfStopped) {
        return null;
      }

      await this.runDocker(['start', containerName], traceId);
      inspectResult = await this.inspectContainer(containerName);
    }

    const hostPort = inspectResult ? extractPublishedPort(inspectResult) : null;
    if (!inspectResult || !hostPort) {
      return null;
    }

    return {
      baseUrl: `http://${this.dockerHost}:${hostPort}`,
      containerId: inspectResult.Id,
      containerName,
      groupId: scope.groupId,
      hostPort,
      mode: 'docker' as const,
      running: Boolean(inspectResult.State?.Running),
      status: inspectResult.State?.Status,
      userId: scope.userId,
      volumeName,
    };
  }

  async executeCommand(
    scope: PiRuntimeScope,
    workspaceDir: string,
    command: string,
    traceId?: string,
    requestedCwd?: string,
  ): Promise<RuntimeCommandResult> {
    const runtime = await this.ensureRuntime(scope, traceId);
    const workspaceCwd = resolveRuntimeWorkspacePath(this.workspaceVolumePath, workspaceDir);
    const cwd = requestedCwd?.trim() || workspaceCwd;

    if (runtime.mode !== 'docker') {
      throw new Error('当前运行时不是容器模式，无法连接容器终端');
    }

    if (!runtime.containerName) {
      throw new Error('PI runtime 容器不可用');
    }

    return this.executeDockerCommand(runtime.containerName, cwd, workspaceCwd, command, traceId);
  }

  private async executeDockerCommand(
    containerName: string,
    cwd: string,
    workspaceCwd: string,
    command: string,
    traceId?: string,
  ): Promise<RuntimeCommandResult> {
    const wrappedCommand = [
      `mkdir -p ${shellQuote(cwd)} && cd ${shellQuote(cwd)}`,
      `ll() { ls -la "$@"; }`,
      `la() { ls -A "$@"; }`,
      `l() { ls -CF "$@"; }`,
      `cd() { if [ "$#" -eq 0 ]; then command cd ${shellQuote(
        workspaceCwd,
      )}; else command cd "$@"; fi; }`,
      command,
      `__openwork_exit_code=$?`,
      `printf '\\n${RUNTIME_CWD_MARKER}%s\\n' "$PWD"`,
      `exit $__openwork_exit_code`,
    ].join('\n');

    try {
      const result = await this.runDocker(
        ['exec', containerName, 'sh', '-lc', wrappedCommand],
        traceId,
        false,
        30000,
      );
      const output = unwrapRuntimeCommandStdout(result.stdout || '', cwd);
      return {
        code: 0,
        command,
        containerName,
        cwd: output.cwd,
        mode: 'docker',
        stderr: result.stderr || '',
        stdout: output.stdout,
      };
    } catch (error: any) {
      const output = unwrapRuntimeCommandStdout(error?.stdout || '', cwd);
      return {
        code: typeof error?.code === 'number' ? error.code : 1,
        command,
        containerName,
        cwd: output.cwd,
        mode: 'docker',
        stderr: error?.stderr || error?.message || '',
        stdout: output.stdout,
        timedOut: Boolean(error?.killed),
      };
    }
  }

  private async createRuntime(scope: PiRuntimeScope, traceId?: string) {
    const { containerName, volumeName } = buildPiRuntimeNames(scope);
    const runtimeGroupId = normalizeRuntimeGroupId(scope.groupId);
    const internalSearchToken = await this.resolveInternalSearchToken();
    const internalSearchUrl = this.resolveInternalSearchUrl();
    await this.runDocker(['volume', 'create', volumeName], traceId).catch(() => undefined);
    try {
      await fs.mkdir(this.dockerRuntimeBundleHostPath, { recursive: true });
    } catch (error) {
      throw new Error(
        `PI runtime 发布目录不可用: ${this.dockerRuntimeBundleHostPath}，请检查目录权限或设置 PI_DOCKER_RUNTIME_BUNDLE_HOST_PATH`,
      );
    }

    const args = [
      'create',
      '--name',
      containerName,
      '--label',
      'openwork.pi.runtime=1',
      '--label',
      `openwork.user-id=${scope.userId}`,
      '--label',
      `openwork.group-id=${runtimeGroupId}`,
      '--restart',
      'unless-stopped',
      '--add-host',
      `${this.dockerBootstrapHostAlias}:host-gateway`,
      '--security-opt',
      'no-new-privileges:true',
      '--cap-drop',
      'ALL',
      '--pids-limit',
      this.dockerPidsLimit,
      '--memory',
      this.dockerMemory,
      '--cpus',
      this.dockerCpus,
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=512m',
      '--mount',
      `type=volume,source=${volumeName},target=${this.workspaceVolumePath}`,
      '--mount',
      `type=bind,source=${this.dockerRuntimeBundleHostPath},target=${this.dockerRuntimeBundleMountPath},readonly`,
      '-p',
      `127.0.0.1::${PI_RUNTIME_CONTAINER_PORT}`,
      '-e',
      `PORT=${PI_RUNTIME_CONTAINER_PORT}`,
      '-e',
      `PI_OPENAI_CWD=${this.workspaceVolumePath}`,
      '-e',
      `PI_RUNTIME_WORKSPACE_ROOT=${this.workspaceVolumePath}`,
      '-e',
      `PI_OPENAI_AGENT_DIR=${this.dockerAgentDir}`,
      '-e',
      `PI_RUNTIME_BUNDLE_DIR=${this.dockerRuntimeBundleMountPath}`,
      '-e',
      `PI_OPENAI_TOOLS=${this.dockerToolsMode}`,
      '-e',
      `OPENWORK_INTERNAL_SEARCH_URL=${internalSearchUrl}`,
      '-e',
      `OPENWORK_INTERNAL_SEARCH_TOKEN=${internalSearchToken}`,
      this.dockerImage,
    ];

    if (this.dockerRuntimeVersion) {
      args.splice(args.length - 1, 0, '-e', `PI_RUNTIME_VERSION=${this.dockerRuntimeVersion}`);
    }

    try {
      await this.runDocker(args, traceId);
      await this.runDocker(['start', containerName], traceId);
      await this.sanitizeRuntimeAgentSecrets(containerName, traceId);
      const bootstrapped = await this.bootstrapRuntimeAgentConfig(containerName, traceId);
      if (bootstrapped) {
        await this.runDocker(['restart', containerName], traceId);
      }
    } catch (error) {
      await this.runDocker(['rm', '-f', containerName], traceId).catch(() => undefined);
      throw error;
    }
  }

  private async resolveInternalSearchToken() {
    const jwtSecret = await this.redisCacheService.getJwtSecret();
    return deriveInternalSearchToken(jwtSecret);
  }

  private resolveInternalSearchUrl() {
    return `http://${this.dockerBootstrapHostAlias}:${this.internalSearchServicePort}${this.internalSearchPath}`;
  }

  private async bootstrapRuntimeAgentConfig(containerName: string, traceId?: string) {
    const sourceDir = this.dockerBootstrapAgentDir;
    if (!sourceDir) {
      return false;
    }

    try {
      await fs.access(sourceDir);
    } catch (_error) {
      Logger.warn(
        `[traceId=${
          traceId || 'runtime'
        }] 未找到 PI bootstrap 配置目录，跳过 agent 配置导入 | ${JSON.stringify({
          sourceDir,
        })}`,
        'PiRuntimeManagerService',
      );
      return false;
    }

    const filesToCopy = resolveRuntimeBootstrapAgentFiles();
    let copied = false;

    await this.runDocker(
      ['exec', containerName, 'sh', '-lc', `mkdir -p ${JSON.stringify(this.dockerAgentDir)}`],
      traceId,
    );

    for (const fileName of filesToCopy) {
      const sourcePath = join(sourceDir, fileName);
      try {
        await fs.access(sourcePath);
      } catch (_error) {
        continue;
      }

      await this.runDocker(
        ['cp', sourcePath, `${containerName}:${this.dockerAgentDir}/${fileName}`],
        traceId,
      );
      copied = true;
    }

    if (copied) {
      Logger.log(
        `[traceId=${traceId || 'runtime'}] 已完成 PI runtime agent 配置导入 | ${JSON.stringify({
          containerName,
          sourceDir,
        })}`,
        'PiRuntimeManagerService',
      );
    }

    return copied;
  }

  private async sanitizeRuntimeAgentSecrets(containerName: string, traceId?: string) {
    await this.runDocker(
      [
        'exec',
        containerName,
        'sh',
        '-lc',
        `mkdir -p ${JSON.stringify(this.dockerAgentDir)} && rm -f ${JSON.stringify(
          `${this.dockerAgentDir}/auth.json`,
        )} ${JSON.stringify(`${this.dockerAgentDir}/models.json`)}`,
      ],
      traceId,
    ).catch(error => {
      Logger.warn(
        `[traceId=${traceId || 'runtime'}] 清理 PI runtime 敏感 agent 配置失败 | ${JSON.stringify({
          containerName,
          error: serializeErrorForLog(error),
        })}`,
        'PiRuntimeManagerService',
      );
    });
  }

  private async waitUntilHealthy(runtime: PiRuntimeDescriptor, traceId?: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.waitReadyTimeoutMs) {
      try {
        const response = await fetch(`${runtime.baseUrl}${this.healthPath}`);
        if (response.ok) {
          return;
        }
      } catch (_error) {
        // keep waiting until timeout
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`PI runtime 启动超时: ${runtime.containerName || runtime.baseUrl}`);
  }

  private async inspectContainer(containerName: string) {
    try {
      const { stdout } = await this.runDocker(['inspect', containerName], undefined, false);
      const parsed = JSON.parse(stdout || '[]') as DockerInspectResult[];
      return parsed[0] || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('No such object') ||
        message.includes('No such container') ||
        message.includes('Error response from daemon')
      ) {
        return null;
      }
      throw error;
    }
  }

  private async runDocker(args: string[], traceId?: string, logErrors = true, timeout?: number) {
    try {
      return await execFileAsync(this.dockerBinary, args, {
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
        timeout,
      });
    } catch (error) {
      if (logErrors) {
        Logger.error(
          `[traceId=${traceId || 'runtime'}] docker 命令执行失败 | ${JSON.stringify({
            args,
            error: serializeErrorForLog(error),
          })}`,
          undefined,
          'PiRuntimeManagerService',
        );
      }
      throw error;
    }
  }
}
