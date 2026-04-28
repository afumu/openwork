# OpenSandbox 运行时改造方案

本文记录 OpenWork 将运行时容器层迁移到 OpenSandbox 的设计方案。

## 当前基线

- 旧的内置运行时工作区、Docker 容器管理、运行时状态接口和运行时打包流程已移除。
- 普通聊天模型已开始走 `service -> OpenSandbox -> openwork-agent-bridge`。
- 用户发起聊天时，`service` 可按 `userId + groupId` 创建或复用 sandbox，并通过容器内 bridge 与 Claude Code 对话。
- 模型密钥、模型名、代理地址和接口格式来自后台模型配置。`service` 不再从环境变量读取模型侧密钥或模型名。
- `chat/` 中的文件面板、工具执行展示、终端面板等交互暂时保留，后续接 OpenSandbox 时复用。
- 聊天记录与历史工具轨迹字段保留，用于兼容既有记录展示。

## 目标

OpenSandbox 成为 OpenWork 唯一的运行时容器入口。`service` 不直接通过 Docker CLI 创建、启动、检查或执行容器，而是通过 OpenSandbox 管理 sandbox 生命周期，并通过 sandbox 内的 `openwork-agent-bridge` 连接 Claude Code、Codex 等 CLI agent。

目标架构：

```text
chat 前端
  -> service /api/openwork/*
     -> 鉴权、计费/额度、日志、群组状态
     -> OpenSandbox
        -> openwork-agent-runtime sandbox
           -> openwork-agent-bridge
              -> Claude Code
              -> Codex
              -> 其他可插拔 agent
```

## 设计原则

- `service` 仍然是产品网关，前端不直接访问 OpenSandbox 或 sandbox endpoint。
- OpenSandbox 负责 sandbox 生命周期、endpoint、命令、文件、资源和隔离。
- OpenWork 自己定义 agent 任务协议、事件协议、鉴权、计费、会话和日志。
- 容器镜像预装 Claude Code、Codex、bridge 和常用工程工具；外部请求选择使用哪个 agent。
- 不用环境变量决定当前容器是哪种 agent。环境变量只用于基础配置、临时凭证、内部代理地址和 workspace 路径。
- 不再维护 Docker 与 OpenSandbox 双 provider，新路径只面向 OpenSandbox。

## OpenSandbox 能力边界

OpenSandbox 提供基础 sandbox 协议：

- Lifecycle API：创建、查询、删除、暂停、恢复、续期 sandbox，获取端口 endpoint。
- Execd API：在 sandbox 内执行 command、创建 bash session、读写文件、查询 metrics，并通过 SSE 返回 stdout、stderr、status、completion 等事件。

这些协议不理解 Claude Code 或 Codex 的业务语义。CLI agent 的工具调用、文本增量、文件变更、任务完成等事件，需要由 `openwork-agent-bridge` 归一化。

## 参考 demo

当前可参考：

```text
/Users/apple/workplace-py/opensandbox/examples/claude-code/supervisor_demo.py
/Users/apple/workplace-py/opensandbox/examples/claude-code/bridge/bridge.mjs
```

demo 的关键点：

1. 外部 supervisor 创建 sandbox。
2. sandbox 内启动长驻 bridge 进程。
3. 外部通过 endpoint 调用 bridge 的 `/message`。
4. 外部通过 `/events` SSE 接收结构化事件。
5. bridge 内部使用 agent SDK 或 CLI 长会话模式，把多轮消息推入同一个 agent 会话。

## Service 适配

建议新增结构：

```text
service/src/modules/aiTool/chat/runtime/
  opensandboxRuntime.service.ts
  opensandboxRuntime.types.ts
  opensandboxClient.ts
  runtimeWorkspace.ts
```

核心职责：

- 按 `userId + groupId` 定位 sandbox。
- 没有 sandbox 时创建新的 `openwork-agent-runtime` sandbox。
- 创建时写入 metadata：`userId`、`groupId`、`runtimeKind=openwork-agent`。
- 注入后台模型配置、搜索桥接、workspace root 等基础配置。
- 获取 bridge 端口 endpoint，例如 `8787`。
- 在请求 bridge 时携带 OpenSandbox endpoint 返回的 headers。
- 返回统一 runtime descriptor。

建议 descriptor：

```ts
type RuntimeDescriptor = {
  mode: 'opensandbox';
  sandboxId: string;
  baseUrl: string;
  endpointHeaders?: Record<string, string>;
  groupId: number | string;
  userId: number;
  workspaceRoot: string;
  workspaceDir: string;
  status?: string;
};
```

## 统一镜像

新增 `openwork-agent-runtime` 镜像。

镜像应内置：

- Claude Code
- Codex CLI
- `openwork-agent-bridge`
- Node.js、Python、git、rg、pnpm、npm、uv 等常用工具

镜像默认启动：

```bash
openwork-agent-bridge --port 8787 --workspace /workspace
```

后续不建议在 sandbox 启动时临时安装 CLI 或 bridge 依赖。CLI 与 bridge 版本应固定在镜像内，便于复现、回滚和排障。

## Bridge 协议

`openwork-agent-bridge` 是 sandbox 内唯一稳定服务入口。`service` 通过 OpenSandbox endpoint 访问 bridge。

建议接口：

```text
GET  /health
POST /v1/agent/runs
POST /v1/agent/message
GET  /v1/agent/events
POST /v1/agent/stop
POST /v1/files/list
POST /v1/files/read
POST /v1/files/write
POST /v1/commands/exec
```

建议 agent run 请求：

```json
{
  "agent": "claude_code",
  "prompt": "修复当前项目里的测试失败",
  "workspace_dir": "conversations/128",
  "session_id": "chat-123",
  "metadata": {
    "groupId": 128,
    "userId": 42
  }
}
```

## 统一事件协议

bridge 需要把 Claude Code、Codex 等输出归一成 OpenWork 事件。前端和 `service` 不直接依赖具体 CLI 的原始输出格式。

建议事件：

```json
{ "type": "run_started", "agent": "claude_code", "run_id": "run_..." }
{ "type": "assistant_delta", "text": "我先检查项目结构。" }
{ "type": "tool_started", "tool": "Bash", "input": { "command": "rg ..." } }
{ "type": "tool_output", "stdout": "...", "stderr": "" }
{ "type": "tool_finished", "tool_call_id": "tool_..." }
{ "type": "file_changed", "path": "src/app.ts" }
{ "type": "run_completed", "result": "已完成修改。" }
{ "type": "run_failed", "error": "..." }
```

可以保留 `raw` 字段用于调试，但默认不展示给用户。

注意：不要把 hidden chain-of-thought 作为产品目标。可以展示计划、可见说明、工具调用、观察结果、文件 diff 和总结，不展示模型内部私密推理。

## 终端与命令执行

当前前端终端交互暂时保留。OpenSandbox 接入后建议分两步恢复后端能力：

1. 第一版使用 OpenSandbox command SSE 或 bridge command session，支持命令执行和日志流展示。
2. 第二版在 bridge 内实现 PTY WebSocket，`service` 只做鉴权和转发。

这样终端能力不会阻塞主聊天和 agent run 改造。

## Workspace 与持久化

默认 workspace root：

```text
/workspace
```

每个对话组 workspace：

```text
/workspace/conversations/<groupId>
```

需要在 OpenSandbox 创建 sandbox 时确定持久化策略：

- 本地开发可使用 host volume。
- 部署环境优先考虑 PVC。
- 后续如果需要跨 runtime 迁移或长期归档，再接对象存储。

第一阶段只要求同一个 `userId + groupId` 能复用同一个 sandbox 或同一个持久 workspace。

## 配置项

建议新增：

```text
OPEN_SANDBOX_DOMAIN
OPEN_SANDBOX_API_KEY
OPENWORK_AGENT_RUNTIME_IMAGE
OPENWORK_AGENT_BRIDGE_PORT=8787
OPENWORK_WORKSPACE_ROOT=/workspace
OPENWORK_SANDBOX_TIMEOUT_SECONDS=3600
OPENWORK_SANDBOX_CPU=2
OPENWORK_SANDBOX_MEMORY=4Gi
```

模型侧配置不放在 `service` 环境变量中。后台模型配置里的密钥、模型名、代理地址和接口格式会传入 sandbox：

- `apiFormat=openai`：注入 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`，同时注入通用 `OPENWORK_MODEL_*`。
- `apiFormat=anthropic`：注入 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`，同时注入通用 `OPENWORK_MODEL_*`。
- 旧的 `apiFormat=opensandbox` 配置按 `anthropic` 兼容处理，不再作为后台可选项展示。

## 实施阶段

### 阶段 1：恢复运行时基础能力

- 已新增 OpenSandbox client。
- 已新增 sandbox descriptor 与 workspace resolver。
- 已新增 bridge health check。
- 已提供 `runtime/status` 的 OpenSandbox 版本。

### 阶段 2：接入文件与命令

- 通过 bridge 或 OpenSandbox Execd 实现文件列表、读取、写入。
- 通过 command SSE 恢复终端输出流。
- 前端保留现有工作区 UI，只替换数据来源。

### 阶段 3：接入 CLI agent

- 已接入 `claude_code` 聊天下游：`service` 通过 bridge message/events 与长驻 Claude Code 会话交互。
- 待补充独立 agent run API。
- 待支持外部选择 `codex` 或其他 agent。
- 把工具调用、文件变更和任务结果写入聊天日志。

### 阶段 4：部署化

- 发布 `openwork-agent-runtime` 镜像。
- 补充 OpenSandbox 配置文档。
- 补充 sandbox 健康检查、日志和排障说明。
