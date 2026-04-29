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

### 2. 旧运行时实现已移除

当前仓库不再包含旧的内置运行时工作区、运行时 Docker 打包流程、运行时状态接口或运行时终端网关。

聊天记录、工具执行轨迹和历史产物字段仍保留在数据库与消息结构中，用于兼容既有记录展示。

### 3. 前端工作区交互暂时保留

`chat/` 中与文件面板、工具执行展示、终端面板相关的交互代码暂时保留，作为后续接入 OpenSandbox 的界面基础。

这些前端交互不代表当前后端已经提供运行时容器能力。

### 4. OpenSandbox 是当前运行时方向

运行时容器和 agent 对话开始接入 OpenSandbox。普通聊天模型由 `service` 按 `userId + groupId` 创建或复用 sandbox、连接容器内 bridge、把 Claude Code 事件流写回聊天流。模型密钥、模型名、代理地址和接口格式来自后台模型配置，并在创建或启动 bridge 时注入容器；不再从 `service` 环境变量读取模型侧密钥或模型名。

右下角终端已按 `service -> OpenSandbox execd PTY` 方向接入 WebSocket 网关。运行时 workspace 默认通过 OpenSandbox volume 挂载到 `/workspace`，按 `userId + groupId` 稳定复用；项目初始化由容器内 `openwork` CLI 负责，CLI 使用随 runtime 镜像打包的内置模板，不通过 `service` 拉取模板。runtime 镜像内置 `openwork` CLI、全局 `/etc/claude-code/CLAUDE.md`，并在 bridge 启动 Claude Agent SDK 时通过 `systemPrompt` 追加 OpenWork 项目创建流程提示。内置前端模板默认使用 runtime 已有的 `npm`，Vite 模板锁定在 Vite 6 稳定线并把开发端口显式设为 `9000`。命令执行、文件读写和更完整的 agent 事件协议仍按 [OpenSandbox 运行时改造方案](./opensandbox-runtime-plan.md) 继续推进。
