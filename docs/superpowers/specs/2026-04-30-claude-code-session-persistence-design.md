# Claude Code 会话持久化设计

状态：已实现。

## 背景

当前 OpenWork 项目模式按 `service -> OpenSandbox -> openwork-agent-bridge -> Claude Code` 运行。`service` 按 `userId + groupId` 创建或复用 sandbox，并通过 bridge 把用户消息送入容器内的 Claude Agent SDK。

普通聊天不进入该 runtime 路径。OpenSandbox agent runtime 只适用于项目群组和 Claude/OpenSandbox 模型键。

`service` 发送的 `session_id: chat-${groupId}` 是 OpenWork 业务会话标识。Claude Code SDK 返回的真实 `session_id` 是另一个 UUID，两者不能混用。

## 已实现目标

- 容器 restart、sandbox 删除重建后，Claude Code 本地历史记录随 `/workspace` volume 保留。
- 重建后的 bridge 可按同一个 OpenWork 项目对话自动尝试恢复到上一次 Claude Code session。
- OpenWork 业务 session 与 Claude Code 真实 session 已区分。
- resume 失败时按降级链路继续对话，不阻塞用户。
- Claude Code runtime 状态路径对 workspace API/list/search/read/mutations 隐藏并拒绝访问。

## 非目标

- 不保证恢复容器内运行中的后台进程、shell 临时状态或内存队列。
- 不把 OpenWork 数据库聊天记录反向重放成 Claude Code transcript。
- 不把 `chat-${groupId}` 当成 Claude Code session id。
- 不在本文定义 workbench 文件面板/API 的完整产品展示行为。

## 核心设计

Claude Code 配置目录放进已持久化的 workspace volume：

```text
/workspace
  ├── 用户项目文件
  └── .openwork
      ├── claude-config
      │   ├── projects/
      │   ├── sessions/
      │   ├── shell-snapshots/
      │   └── ...
      └── claude-session.json
```

bridge 启动 Claude Agent SDK 时设置：

```text
CLAUDE_CONFIG_DIR=/workspace/.openwork/claude-config
```

并保持：

```text
cwd=/workspace
persistSession=true
```

这样 Claude Code 的 transcript 和 session 文件会跟 `/workspace` volume 一起持久化。容器重建后，只要 OpenSandbox 挂回同一个 `userId + groupId` workspace volume，bridge 就能重新读取同一份 Claude Code 本地状态。

## Session 关联模型

OpenWork 和 Claude Code 的 session 是两层不同概念：

```text
OpenWork 业务会话
  userId + groupId + openworkSessionId(chat-${groupId})
        |
        v
稳定 workspace volume
  /workspace
        |
        v
/workspace/.openwork/claude-session.json
        |
        v
Claude Code 真实 session
  claudeSessionId(UUID)
```

`claude-session.json` 指针包含恢复必需字段和可选 OpenWork 元数据，例如：

```json
{
  "version": 1,
  "provider": "claude",
  "openworkSessionId": "chat-54",
  "userId": "1",
  "groupId": "54",
  "workspace": "/workspace",
  "claudeSessionId": "9fc27e06-0c44-4a1f-8819-d06d039adc09",
  "updatedAt": "2026-04-30T12:00:00.000Z"
}
```

当前读取逻辑只校验：

- `provider`
- `workspace`
- `claudeSessionId`

`openworkSessionId`、`userId`、`groupId` 可写入用于观测和排障，但当前读取逻辑不依赖这些字段做强校验。

bridge 从 Claude SDK 事件里捕获真实 `message.session_id`。当该 id 首次出现或发生变化时，bridge 原子写入 `claude-session.json`。

## 启动与恢复流程

### 首次启动

```text
service ensureRuntime(userId, groupId)
  -> OpenSandbox 创建 sandbox，并挂载 /workspace volume
  -> bridge bootstrap 创建 /workspace/.openwork/claude-config
  -> bridge 设置 CLAUDE_CONFIG_DIR
  -> bridge 启动 query()
  -> Claude SDK 返回真实 session_id
  -> bridge 写入 claude-session.json
```

### 容器重启或重建后

```text
service ensureRuntime(userId, groupId)
  -> OpenSandbox 创建或连接 sandbox，并挂回同一个 /workspace volume
  -> bridge 读取 /workspace/.openwork/claude-session.json
  -> 校验 provider、workspace、claudeSessionId
  -> 使用 claudeSessionId 启动 query({ options: { resume } })
  -> 后续用户消息继续进入同一个 query queue
```

如果没有 `claude-session.json`，bridge 启动 fresh session，并在 SDK 返回真实 session id 后写入指针。

## Resume 降级策略

resume 不保证成功。可能失败的原因包括 transcript 文件缺失、`.jsonl` 损坏、SDK 版本升级导致格式不兼容、记录的 cwd 或配置不匹配。

bridge 启动时使用以下降级链路：

```text
1. 有可用 claudeSessionId -> query({ resume: claudeSessionId })
2. resume 失败 -> 记录 session_resume_failed
3. 尝试 query({ continue: true })
4. continue 失败 -> 记录 session_continue_failed
5. 启动 fresh query()
```

降级后仍继续使用同一个 `CLAUDE_CONFIG_DIR`。旧历史文件不删除，便于排障和人工恢复。

## 并发保护

同一个 `userId + groupId` 理论上可能同时收到多条消息，或发生旧 bridge 未完全退出、新 bridge 已启动的竞态。

已实现的关键保护是 bridge 写 `claude-session.json` 时使用 atomic write：

```text
write claude-session.json.tmp
fsync/flush best effort
rename claude-session.json.tmp -> claude-session.json
```

如果读取时 JSON 损坏或校验失败，bridge 忽略该指针并走降级链路。

## 文件可见性

`/workspace/.openwork` 是运行时内部状态，不应展示给用户，也不应被 workspace 文件扫描、项目构建或普通 workspace 操作主动处理。

当前策略是隐藏并拒绝整个 `.openwork` 路径，包括但不限于：

```text
.openwork/claude-config
.openwork/claude-session.json
```

如果后续需要公开 `.openwork` 下的某个产品级文件，应单独设计精确放行规则；默认不要整体暴露 `.openwork`。

## 安全与隔离

当前 Claude Code 权限模式允许其读写 `/workspace`，因此理论上可以读写 `/workspace/.openwork`。已通过以下方式降低误操作概率：

- runtime 全局 `/etc/claude-code/CLAUDE.md` 明确要求不要修改 `.openwork/claude-config` 或 `.openwork/claude-session.json`。
- workspace API/list/search/read/mutations 隐藏并拒绝所有 `.openwork` 路径。

如果后续需要更强隔离，可以把 Claude config 挂载到独立 volume，或由 bridge 进程在更受控的目录中管理。

## 事件与可观测性

bridge/session 相关事件或日志包括：

```json
{ "type": "session_resume_started", "session_id": "..." }
{ "type": "session_resume_succeeded", "session_id": "..." }
{ "type": "session_resume_failed", "session_id": "...", "message": "..." }
{ "type": "session_continue_failed", "message": "..." }
{ "type": "session_started", "session_id": "..." }
{ "type": "bridge_ready", "session_id": "..." }
```

没有单独的 explicit fresh event。fresh query 启动由 `session_started` 和 `bridge_ready` 体现。

## 验证场景

1. 构建 runtime 镜像：`docker build -t openwork-agent-runtime:latest -f service/docker/openwork-agent-runtime/Dockerfile .`。
2. 创建新的项目 sandbox 并发起首次对话，确认 `/workspace/.openwork/claude-config/projects` 下生成 transcript。
3. 首次对话后，确认 `/workspace/.openwork/claude-session.json` 写入真实 Claude session id。
4. 重启同一容器后发第二条消息，确认 bridge 使用同一 session id 或按降级链路继续。
5. 删除 sandbox 并重建后发第二条消息，确认同一个 workspace volume 被挂回，bridge 尝试 resume。
6. 手动破坏 `claude-session.json` 后启动，确认走降级链路且对话不中断。
7. 通过 workspace API/list/search/read/mutations 验证 `.openwork` 路径不可见且不可改。

注意：已有 sandbox 不会自动获得 bridge 或 runtime 指令镜像变更；验证前需要重建镜像并重新创建 sandbox。

## 后续开放问题

- 是否需要为用户提供“清空 Claude Code 本地历史”的产品入口。
- 是否需要对 Claude config 目录增加大小监控或清理策略。
- 多实例部署下是否需要更强的跨实例并发控制。
