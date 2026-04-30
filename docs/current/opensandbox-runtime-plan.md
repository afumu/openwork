# OpenSandbox 运行时现状与后续计划

本文记录 OpenWork 当前 OpenSandbox runtime 的实现状态，以及仍未完成的后续工作。

## 当前架构

项目模式下，Claude/OpenSandbox 模型键走 OpenSandbox agent runtime：

```text
chat 前端
  -> service /api/openwork/*
     -> 鉴权、计费/额度、日志、群组状态
     -> OpenSandbox
        -> openwork-agent-runtime sandbox
           -> openwork-agent-bridge
              -> Claude Code
```

普通聊天不进入 OpenSandbox agent runtime。OpenSandbox 路径只适用于项目群组和 Claude/OpenSandbox 模型键。

`service` 仍然是产品网关。前端不直接访问 OpenSandbox endpoint；`service` 负责 runtime 定位、sandbox 生命周期请求、bridge HTTP/SSE 连接、PTY WebSocket 转发、聊天流写回和日志。

## 当前已实现事实

- 旧的内置 Docker runtime 工作区、Docker 容器管理和运行时打包路径已移除。
- `service` 可按 `userId + groupId` 创建或复用 OpenSandbox sandbox。
- 默认 runtime 镜像为 `OPENWORK_AGENT_RUNTIME_IMAGE || SANDBOX_IMAGE || openwork-agent-runtime:latest`。
- runtime 镜像基于 `opensandbox/code-interpreter:v1.0.2`，打包 bridge、`/etc/claude-code/CLAUDE.md`、runtime `openwork` CLI，并把 CLI 暴露为 `openwork` 命令。
- 模型密钥、模型名、代理地址和接口格式来自后台模型配置，在创建或启动 bridge 时注入 sandbox；不再从 `service` 环境变量读取模型侧密钥或模型名。
- bridge 真实 HTTP/SSE 入口为 `GET /health`、`GET /events`、`POST /message`、`POST /stop`。
- 右下角终端已接入 `service -> OpenSandbox execd PTY` WebSocket 网关。
- workspace 默认通过 OpenSandbox volume 挂载到 `/workspace`，按 `userId + groupId` 稳定复用。
- Claude Code 本地状态持久化到 `/workspace/.openwork/claude-config`，session 指针写入 `/workspace/.openwork/claude-session.json`。
- workspace API/list/search/read/mutations 隐藏并拒绝所有 `.openwork` 路径。

## Bridge 与会话

`service` 发送给 bridge 的 `session_id: chat-${groupId}` 是 OpenWork 业务会话标识，不是 Claude Code 真实 session id。bridge 从 Claude Agent SDK 事件中捕获真实 `claudeSessionId`，并维护 `/workspace/.openwork/claude-session.json`。

当前 session 指针读取只校验：

- `provider`
- `workspace`
- `claudeSessionId`

指针可以携带 `openworkSessionId`、`userId`、`groupId` 等 OpenWork 元数据，但当前读取逻辑不依赖这些字段做强校验。

恢复降级链路：

```text
resume -> continue -> fresh
```

相关事件/日志包括：

- `session_resume_started`
- `session_resume_succeeded`
- `session_resume_failed`
- `session_continue_failed`
- `session_started`
- `bridge_ready`

没有单独的 explicit fresh event；fresh 启动通过 `session_started` 和 `bridge_ready` 体现。

## 终端与命令执行

现行终端路径：

```text
chat xterm
  -> service /api/openwork/runtime/terminal WebSocket
     -> 校验 token + groupId
     -> 定位 userId + groupId 对应 sandbox
     -> OpenSandbox execd POST /pty
     -> OpenSandbox execd /pty/:session_id/ws
```

`service` 不把 OpenSandbox endpoint 暴露给前端，只做鉴权、runtime 定位和 PTY WebSocket 协议转发。前端继续使用 xterm 面板，发送 `input`、`resize` 等 JSON 消息；`service` 转换为 execd PTY 的 binary stdin 与 JSON resize 帧，再把 execd stdout/stderr 转回前端可消费的 `output` 消息。

当前 OpenSandbox execd 的 `/pty` 请求只传入 `cwd`。OpenWork 固定把终端工作目录传为 runtime workspace，并在 ready 消息里返回 `cwd` 和 `/bin/bash` shell 信息。因为 execd 启动的是不读取 profile/rc 的 Bash，OpenWork 会在 PTY 打开后注入交互终端 bootstrap，补齐 `TERM=xterm-256color`、`COLORTERM=truecolor`、`ll`/`la`/`l` 和 `clear` fallback；初始化输出由 `service` 转发层吞掉。

## Workspace 与隐藏状态

默认 workspace root：

```text
/workspace
```

当前持久化策略：

- 默认 `OPENWORK_WORKSPACE_BACKEND=volume`，使用 OpenSandbox volume 挂载到 `/workspace`。
- Docker runtime 下对应 Docker named volume。
- Kubernetes runtime 下对应 PVC。
- volume 名称按 `userId + groupId` 稳定生成，同一个项目对话复用同一个 workspace。
- 如需回退到容器临时目录，可设置 `OPENWORK_WORKSPACE_BACKEND=container`。

隐藏 runtime 元数据策略：所有 `.openwork` 路径都视为 runtime 内部状态，workspace API/list/search/read/mutations 均不得展示或修改。

## 配置项

OpenSandbox 与 runtime 环境变量：

```text
OPEN_SANDBOX_API_KEY / SANDBOX_API_KEY
OPEN_SANDBOX_DOMAIN / SANDBOX_DOMAIN
OPEN_SANDBOX_USE_SERVER_PROXY
OPENWORK_AGENT_RUNTIME_IMAGE
SANDBOX_IMAGE
OPENWORK_AGENT_BRIDGE_PORT=8787
OPENWORK_SANDBOX_EXECD_PORT=44772
OPENWORK_SANDBOX_CPU=2
OPENWORK_SANDBOX_MEMORY=4Gi
OPENWORK_SANDBOX_TIMEOUT_SECONDS=3600
OPENWORK_WORKSPACE_BACKEND=volume
OPENWORK_WORKSPACE_ROOT=/workspace
OPENWORK_WORKSPACE_VOLUME_PREFIX=openwork-ws
OPENWORK_WORKSPACE_VOLUME_SIZE=5Gi
OPENWORK_WORKSPACE_VOLUME_STORAGE_CLASS=
OPENWORK_WORKSPACE_DELETE_ON_CLOSE=false
```

模型侧配置不放在 `service` 环境变量中。后台模型配置里的密钥、模型名、代理地址和接口格式会传入 sandbox：

- `apiFormat=openai`：注入 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`，同时注入通用 `OPENWORK_MODEL_*`。
- `apiFormat=anthropic`：注入 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`，同时注入通用 `OPENWORK_MODEL_*`。
- 旧的 `apiFormat=opensandbox` 配置按 `anthropic` 兼容处理，不再作为后台可选项展示。

## 镜像构建与验证

构建 runtime 镜像：

```bash
docker build -t openwork-agent-runtime:latest -f service/docker/openwork-agent-runtime/Dockerfile .
```

已有 sandbox 不会自动获得 bridge、CLI 或 `/etc/claude-code/CLAUDE.md` 的镜像变更。验证 session 持久化或 runtime 指令更新时，需要重建镜像并重新创建 sandbox。

## 后续工作

已实现的 runtime 基线不代表所有 workbench/API 能力都完成。剩余事项应继续按对应文档拆分：

- 独立 agent run API 与更完整的 agent 事件协议。
- Codex 或其他 agent 的外部选择与桥接。
- 文件面板、工作区 API 与 workbench 展示细节见对应 workbench/API 文档，不在本文重复展开。
- sandbox 健康检查、日志聚合和排障说明继续补充到部署/运维文档。
