# 仓库地图

## 主要模块

### `chat/`

- 基于 Vue 3 的用户工作区
- 负责聊天界面、工具执行展示、Monaco runtime 工作台、文件面板与 OpenSandbox 终端交互 UI
- 项目群组下的 Claude/OpenSandbox 模型键通过 `service` 接入 OpenSandbox agent runtime

### `admin/`

- 基于 Vue 3 + Vite 的管理控制台
- 负责模型配置、搜索配置、平台设置与运维操作

### `service/`

- 基于 NestJS 的后端服务
- 负责鉴权、用量、日志、模型请求、搜索能力与业务接口
- 负责 OpenSandbox runtime 定位、bridge 连接、PTY/WebSocket 转发、workspace API 和隐藏 `.openwork` runtime 状态

### `service/docker/openwork-agent-runtime/`

- OpenSandbox sandbox 使用的 `openwork-agent-runtime` 镜像定义
- 打包 `openwork-agent-bridge`、Claude Code 指令和 runtime `openwork` CLI

### `docs/`

- 当前有效的仓库文档入口
- `docs/current/` 记录系统现状、OpenSandbox runtime、runtime workspace API 和后续计划
- `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 记录设计和历史实施计划，除非文件顶部明确标为当前，否则不作为当前事实

## 常用入口

- [docs/README.md](../README.md)
- [docs/current/system-status.md](../current/system-status.md)
- [docs/current/opensandbox-runtime-plan.md](../current/opensandbox-runtime-plan.md)
- [docs/current/runtime-workspace-api.md](../current/runtime-workspace-api.md)
- [docs/overview/development-style.md](./development-style.md)
- [docs/operations/deployment.md](../operations/deployment.md)
