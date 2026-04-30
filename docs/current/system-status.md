# 当前系统状态

## 主流程

```text
chat 前端
  -> service /api/openwork/*
     -> 鉴权、计费/额度、日志、群组状态
     -> 模型供应商 API
```

## 当前事实

### 1. `service` 仍然是产品网关

前端通过 `service` 访问产品能力。`service` 负责：

- 鉴权与用户状态
- 用量、计费或额度
- 聊天日志与群组状态
- 模型配置与请求转发
- 平台级搜索能力
- OpenSandbox runtime 定位、bridge 连接与 PTY/WebSocket 转发

### 2. OpenSandbox 是当前项目运行时

旧的内置 Docker runtime 已移除。当前项目模式下，Claude/OpenSandbox 模型键会走：

```text
chat 前端
  -> service /api/openwork/*
     -> OpenSandbox sandbox
        -> openwork-agent-runtime
           -> openwork-agent-bridge
              -> Claude Code
```

普通聊天不进入 OpenSandbox agent runtime。OpenSandbox agent 路径只适用于项目群组以及 Claude/OpenSandbox 模型键。

### 3. runtime 镜像与 workspace

`openwork-agent-runtime` 镜像基于 `opensandbox/code-interpreter:v1.0.2`，内置 bridge、`/etc/claude-code/CLAUDE.md`、runtime `openwork` CLI，并把 CLI 暴露为 `openwork` 命令。

默认 workspace 通过 OpenSandbox volume 挂载到 `/workspace`，按 `userId + groupId` 稳定复用。项目初始化由容器内 `openwork` CLI 使用随镜像打包的内置模板完成，不通过 `service` 拉取模板。内置前端模板默认使用 runtime 已有的 `npm`，Vite 模板锁定在 Vite 6 稳定线并把开发端口显式设为 `9000`。

### 4. 终端、文件与隐藏 runtime 状态

右下角终端已接入 `service -> OpenSandbox execd PTY` WebSocket 网关。`service` 不把 OpenSandbox endpoint 暴露给前端，只做鉴权、runtime 定位和 PTY 协议转发。

Claude Code 状态持久化在 `/workspace/.openwork/claude-config` 与 `/workspace/.openwork/claude-session.json`。workspace API/list/search/read/mutations 隐藏并拒绝所有 `.openwork` 路径，避免用户文件面板或普通 workspace 操作改动 runtime 内部状态。

### 5. Claude Code session 持久化

`service` 发送的 `session_id: chat-${groupId}` 是 OpenWork 业务会话标识，不是 Claude Code 真实 session id。bridge 从 Claude SDK 事件中记录真实 `claudeSessionId`，写入 `/workspace/.openwork/claude-session.json`，并在 sandbox 重建后按 `resume -> continue -> fresh` 降级链路恢复。相关事件/日志包括 `session_resume_started`、`session_resume_succeeded`、`session_resume_failed`、`session_continue_failed`、`session_started`、`bridge_ready`。

更多运行时配置和剩余未来工作见 [OpenSandbox 运行时改造方案](./opensandbox-runtime-plan.md)。
