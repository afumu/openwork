# 部署说明

OpenWork 部署包含主服务、前端产物，以及项目模式使用的 OpenSandbox runtime 镜像。普通聊天仍由 `service` 直接转发模型请求；项目群组下的 Claude/OpenSandbox 模型键会进入 OpenSandbox agent runtime。

## 主要组成

1. 主服务：由 PM2 托管的 `service/dist`
2. 前端产物：`admin/dist` 与 `chat/dist`
3. 配置文件：由 `service/.env.example` 初始化
4. Runtime 镜像：`openwork-agent-runtime:latest`，用于 OpenSandbox sandbox

## 推荐流程

1. 构建主服务和前端：`./build.sh`
2. 构建 runtime 镜像：

   ```bash
   docker build -t openwork-agent-runtime:latest -f service/docker/openwork-agent-runtime/Dockerfile .
   ```

3. 将 `deploy/` 发布到服务器
4. 配置 `service` 环境变量，至少包含 OpenSandbox endpoint/API key 和 runtime 镜像名
5. 在服务器执行 `cd deploy && ./start.sh`
6. 通过 `pm2 status` 与 `pm2 logs openwork` 检查服务状态
7. 创建或重建项目 sandbox，验证 bridge `/health`、聊天事件流、PTY 终端和 `/workspace` 持久化

## OpenSandbox / runtime 环境变量

OpenSandbox 连接：

```text
OPEN_SANDBOX_API_KEY / SANDBOX_API_KEY
OPEN_SANDBOX_DOMAIN / SANDBOX_DOMAIN
OPEN_SANDBOX_USE_SERVER_PROXY
```

Runtime 镜像和端口：

```text
OPENWORK_AGENT_RUNTIME_IMAGE=openwork-agent-runtime:latest
SANDBOX_IMAGE=
OPENWORK_AGENT_BRIDGE_PORT=8787
OPENWORK_SANDBOX_EXECD_PORT=44772
```

默认镜像选择顺序为：

```text
OPENWORK_AGENT_RUNTIME_IMAGE || SANDBOX_IMAGE || openwork-agent-runtime:latest
```

Sandbox 资源与生命周期：

```text
OPENWORK_SANDBOX_CPU=2
OPENWORK_SANDBOX_MEMORY=4Gi
OPENWORK_SANDBOX_TIMEOUT_SECONDS=3600
```

Workspace volume：

```text
OPENWORK_WORKSPACE_BACKEND=volume
OPENWORK_WORKSPACE_ROOT=/workspace
OPENWORK_WORKSPACE_VOLUME_PREFIX=openwork-ws
OPENWORK_WORKSPACE_VOLUME_SIZE=5Gi
OPENWORK_WORKSPACE_VOLUME_STORAGE_CLASS=
OPENWORK_WORKSPACE_DELETE_ON_CLOSE=false
```

## Runtime 镜像说明

`openwork-agent-runtime` 基于 `opensandbox/code-interpreter:v1.0.2`，内置：

- `openwork-agent-bridge`
- `/etc/claude-code/CLAUDE.md`
- runtime `openwork` CLI，并 symlink 为 `openwork`
- Claude Code 运行所需基础环境

已有 sandbox 不会自动获得镜像变更。更新 bridge、runtime CLI、全局 Claude 指令或 session 持久化逻辑后，需要重建镜像并重新创建 sandbox 才能验证。

Claude Code 持久状态位于 `/workspace/.openwork/claude-config` 和 `/workspace/.openwork/claude-session.json`。这些路径是 runtime 内部状态，workspace API/list/search/read/mutations 应隐藏并拒绝访问。

## 说明

- `./build.sh` 不构建 runtime 镜像；runtime 镜像需要单独执行 Docker build。
- `deploy/start.sh` 启动主服务，不负责创建或刷新已有 sandbox。
- 模型侧密钥、模型名、代理地址和接口格式来自后台模型配置，并在创建或启动 bridge 时注入 sandbox；不放在部署环境变量中。
