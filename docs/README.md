# OpenWork 文档导览

从这里开始阅读，只有在任务确实需要时再继续深入。

## 阅读顺序

1. [当前状态](./current/system-status.md)：当前架构、OpenSandbox runtime、session 持久化和 workspace 事实。
2. [OpenSandbox 运行时现状与后续计划](./current/opensandbox-runtime-plan.md)：runtime 镜像、bridge、PTY 终端、workspace volume 和剩余工作。
3. [Runtime workspace API current state](./current/runtime-workspace-api.md)：Monaco 可编辑工作台使用的当前 workspace API。
4. [部署说明](./operations/deployment.md)：主服务、前端产物和 `openwork-agent-runtime` 镜像部署。
5. [仓库地图](./overview/repo-map.md)：目录职责和常用入口。
6. [开发风格指南](./overview/development-style.md)：改代码前阅读。

## 已实现设计记录

这些文档记录已经落地或部分落地的设计背景；当前事实仍以 `docs/current/` 为准：

- [Runtime 工作台 Monaco 编辑器设计](./superpowers/specs/2026-04-30-runtime-workbench-monaco-editor-design.md)
- [Claude Code 会话持久化设计](./superpowers/specs/2026-04-30-claude-code-session-persistence-design.md)

## 其他说明

- `docs/superpowers/plans/` 主要是实施计划和历史记录；除非文件顶部明确标为当前，否则不要当作当前架构事实。
- [开源说明](./overview/open-source-note.md)

## 编写原则

- 文档保持最新，并尽量简短。
- 优先记录当前架构和现行运维规则，而不是归档历史。
- 对于产品专属文档，宁可删除，也不要任其失效漂移。
