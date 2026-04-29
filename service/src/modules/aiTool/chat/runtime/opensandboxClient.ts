import { Injectable, Logger } from '@nestjs/common';
import type {
  OpenSandboxClient,
  OpenSandboxClientCreateInput,
  OpenSandboxRuntimeConfig,
  OpenSandboxSandbox,
} from './opensandboxRuntime.types';

type OpenSandboxSdk = {
  ConnectionConfig: new (options: any) => any;
  Sandbox: {
    connect(options: any): Promise<OpenSandboxSandbox>;
    create(options: any): Promise<OpenSandboxSandbox>;
  };
  SandboxManager?: {
    create(options: any): {
      close?(): Promise<void>;
      listSandboxInfos(filter?: any): Promise<{ items?: any[] }>;
    };
  };
};

const OPEN_SANDBOX_PACKAGE = '@alibaba-group/opensandbox';

async function importOpenSandboxSdk(): Promise<OpenSandboxSdk> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier);') as (
      specifier: string,
    ) => Promise<OpenSandboxSdk>;
    return await dynamicImport(OPEN_SANDBOX_PACKAGE);
  } catch (error) {
    Logger.error(
      `OpenSandbox Node SDK 未安装，请在 service 中安装 ${OPEN_SANDBOX_PACKAGE}`,
      error instanceof Error ? error.stack : undefined,
      'OpenSandboxClientService',
    );
    throw error;
  }
}

@Injectable()
export class OpenSandboxClientService implements OpenSandboxClient {
  private sdkPromise: Promise<OpenSandboxSdk> | null = null;

  private getSdk() {
    this.sdkPromise ??= importOpenSandboxSdk();
    return this.sdkPromise;
  }

  private async createConnectionConfig(config: OpenSandboxRuntimeConfig) {
    const sdk = await this.getSdk();
    return new sdk.ConnectionConfig({
      apiKey: config.apiKey,
      domain: config.domain,
      requestTimeoutSeconds: 300,
      useServerProxy: config.useServerProxy,
    });
  }

  async createSandbox(input: OpenSandboxClientCreateInput): Promise<OpenSandboxSandbox> {
    const config = readOpenSandboxRuntimeConfig();
    const sdk = await this.getSdk();
    const resource: Record<string, string> = {
      ...(input.resource || {}),
    };

    const connectionConfig = await this.createConnectionConfig(config);
    return sdk.Sandbox.create({
      connectionConfig,
      env: input.env,
      image: input.image,
      metadata: input.metadata,
      resource,
      timeoutSeconds: input.timeoutSeconds,
    });
  }

  async connectSandbox(sandboxId: string): Promise<OpenSandboxSandbox> {
    const config = readOpenSandboxRuntimeConfig();
    const sdk = await this.getSdk();
    const connectionConfig = await this.createConnectionConfig(config);

    return sdk.Sandbox.connect({
      connectionConfig,
      sandboxId,
    });
  }

  async findSandboxByMetadata(metadata: Record<string, string>): Promise<{ id: string } | null> {
    const config = readOpenSandboxRuntimeConfig();
    const sdk = await this.getSdk();
    const connectionConfig = await this.createConnectionConfig(config);

    if (!sdk.SandboxManager) {
      return null;
    }

    const manager = sdk.SandboxManager.create({ connectionConfig });
    try {
      const list = await manager.listSandboxInfos({
        metadata,
        page: 1,
        pageSize: 1,
        states: ['Running', 'Creating', 'Paused', 'Resuming'],
      });
      const first = list.items?.[0];
      return first?.id ? { id: String(first.id) } : null;
    } finally {
      await manager.close?.();
    }
  }
}

export function readOpenSandboxRuntimeConfig(): OpenSandboxRuntimeConfig {
  return {
    apiKey: process.env.OPEN_SANDBOX_API_KEY || process.env.SANDBOX_API_KEY || undefined,
    bridgePort: Number(process.env.OPENWORK_AGENT_BRIDGE_PORT || 8787),
    cpu: process.env.OPENWORK_SANDBOX_CPU || '2',
    domain: process.env.OPEN_SANDBOX_DOMAIN || process.env.SANDBOX_DOMAIN || 'localhost:8080',
    execdPort: Number(process.env.OPENWORK_SANDBOX_EXECD_PORT || 44772),
    image:
      process.env.OPENWORK_AGENT_RUNTIME_IMAGE ||
      process.env.SANDBOX_IMAGE ||
      'openwork-agent-runtime:latest',
    memory: process.env.OPENWORK_SANDBOX_MEMORY || '4Gi',
    timeoutSeconds: Number(process.env.OPENWORK_SANDBOX_TIMEOUT_SECONDS || 3600),
    useServerProxy:
      String(process.env.OPEN_SANDBOX_USE_SERVER_PROXY || '').toLowerCase() === 'true',
    workspaceRoot: process.env.OPENWORK_WORKSPACE_ROOT || '/workspace',
  };
}
