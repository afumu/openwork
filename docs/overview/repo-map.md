# 仓库地图

## 主要模块

### `chat/`

- 基于 Vue 3 的用户工作区
- 负责聊天界面、工具执行展示、文件面板与终端交互 UI
- 当前前端工作区交互暂时保留，后续用于 OpenSandbox 接入

### `admin/`

- 基于 Vue 3 + Vite 的管理控制台
- 负责模型配置、搜索配置、平台设置与运维操作

### `service/`

- 基于 NestJS 的后端服务
- 负责鉴权、用量、日志、模型请求、搜索能力与业务接口

### `docs/`

- 当前有效的仓库文档
- 记录系统现状、开发风格、部署流程和 OpenSandbox 改造方案

## 常用入口

- [docs/README.md](../README.md)
- [docs/current/system-status.md](../current/system-status.md)
- [docs/current/opensandbox-runtime-plan.md](../current/opensandbox-runtime-plan.md)
- [docs/overview/development-style.md](./development-style.md)
- [docs/operations/deployment.md](../operations/deployment.md)
