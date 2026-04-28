import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { OpenSandboxClientService, readOpenSandboxRuntimeConfig } from './opensandboxClient';
import type {
  EnsureRuntimeInput,
  OpenSandboxClient,
  OpenSandboxRuntimeConfig,
  OpenSandboxSandbox,
  RuntimeDescriptor,
  RuntimeStatusInput,
} from './opensandboxRuntime.types';
import { buildRuntimeMetadata, resolveRuntimeWorkspace } from './runtimeWorkspace';

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
    const metadata = buildRuntimeMetadata({ groupId: input.groupId, userId: input.userId });
    const workspace = resolveRuntimeWorkspace({
      groupId: input.groupId,
      workspaceRoot: config.workspaceRoot,
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
    const metadata = buildRuntimeMetadata({ groupId: input.groupId, userId: input.userId });
    const existing = await this.client.findSandboxByMetadata(metadata);

    if (!existing) {
      return null;
    }

    const sandbox = await this.client.connectSandbox(existing.id);
    return this.buildDescriptor(sandbox, input, config);
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
      const stderr = Array.isArray(result.logs?.stderr)
        ? result.logs?.stderr.join('\n')
        : result.logs?.stderr || '';
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
