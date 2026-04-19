# OpenWork

OpenWork 是一个面向组织部署的浏览器智能体平台。
它把聊天工作台、管理后台、产品网关和独立运行时组合成一套可落地的系统：部署完成后，团队只需要创建账号并配置模型，用户就可以直接在 Web 应用里完成对话、工具调用、文件处理和浏览器内工作，而不必先准备本地开发环境。

OpenWork is a browser-based agent platform for teams that want a deployable, web-first AI workspace.
It combines a user-facing chat workspace, an admin console, a product gateway, and an isolated runtime layer so that teams can deploy once, configure models centrally, and let users work directly in the browser.

## OpenWork 是什么

OpenWork 面向这样一类场景：

- 希望把智能体能力部署到自有环境，而不是只依赖托管产品
- 希望统一模型配置、搜索配置、权限和运行时策略
- 希望用户直接在浏览器里完成对话、工具执行和文件交互
- 希望运行时按用户隔离，同时保持平台能力通用化

从架构上看，OpenWork 不是“单个聊天应用”，而是一套由前端、后端、运行时和部署流程共同组成的平台仓库。

## What OpenWork Is

OpenWork is designed for teams that want more than a thin chat UI:

- a browser-based AI workspace for end users
- centralized admin control for models and platform settings
- a backend gateway that owns auth, billing/quota, logging, and routing
- a generic runtime layer that can be deployed and versioned independently
- per-user runtime isolation when containerized execution is enabled

The repo is intentionally structured as a platform codebase rather than a single product surface.

## Core Capabilities

- Browser-based chat workspace and tool-driven workflows
- Centralized admin console for model, search, and platform configuration
- `service` as the product gateway for auth, billing/quota, logs, and runtime dispatch
- Generic `web_search` integration routed through the backend
- Per-user runtime containers for isolated workspaces
- Versioned runtime bundle build and publish flow
- Internal model proxy for centralized model access

## Architecture

当前主流程如下：

```text
chat frontend
  -> service /api/openwork/*
     -> auth, billing/quota, logs, group state
     -> PI runtime /v1/chat/completions
        -> agent session / direct model path / discussion
        -> host bridges back to service
           -> model proxy
           -> search bridge
```

几个关键边界：

- `service/` 仍然是产品网关，前端不会直接调用 runtime
- 搜索能力通过统一平台接口暴露，而不是在前端散落接入
- runtime 保持通用，不内置产品专属工作流
- 当 `PI_DOCKER_ENABLED=1` 时，运行时容器按用户隔离
- runtime bundle 仍然是部署与版本切换的基本单位

更详细的当前事实可以查看 [docs/current/system-status.md](./docs/current/system-status.md)。

## Repository Layout

- `chat/`
  用户工作区与聊天界面，基于 Vue 3，负责对话、工具执行展示、文件与制品交互。

- `admin/`
  管理后台，基于 Vue 3 + Vite，负责模型配置、搜索配置、平台设置与运维入口。

- `service/`
  NestJS 后端，负责鉴权、用量/额度、日志、运行时编排、搜索桥接和内部模型代理。

- `pi/`
  独立运行时工作区，负责智能体运行时、工具、工作区和运行时打包产物。

- `docs/`
  当前有效的仓库文档入口，记录系统现状、风格约束和部署说明。

## Quick Start

### 常用命令

```bash
./build.sh
cd admin && pnpm dev
cd chat && pnpm dev
cd service && pnpm dev
cd pi && npm run check
```

### 建议阅读顺序

1. [docs/README.md](./docs/README.md)
2. [docs/current/system-status.md](./docs/current/system-status.md)
3. [docs/overview/repo-map.md](./docs/overview/repo-map.md)
4. [docs/overview/development-style.md](./docs/overview/development-style.md)
5. [docs/operations/deployment.md](./docs/operations/deployment.md)

## Development Notes

- `chat/` 维持现有无分号风格
- `admin/` 与 `service/` 维持现有有分号 TypeScript 风格
- `pi/` 使用 Biome，采用独立的双引号 + Tab 风格
- 修改前优先阅读 [docs/overview/development-style.md](./docs/overview/development-style.md)
- 不直接编辑生成产物，例如 `dist/`

## What This Repo Includes

- Per-user runtime isolation
- Runtime bundle build and publish workflow
- Web-based coding and chat workspace
- Tool execution and artifact handling
- Generic platform search integration
- Internal model proxy and runtime gateway design

## What This Repo Does Not Include

- Product-specific editorial workflows baked into the default runtime
- Fixed multi-stage content pipelines tied to one business scenario
- A single hardcoded skill pack for one use case

## Docs

- [文档导览 / Docs Guide](./docs/README.md)
- [开源说明 / Open Source Note](./docs/overview/open-source-note.md)
- [当前系统状态 / Current System Status](./docs/current/system-status.md)
- [仓库地图 / Repo Map](./docs/overview/repo-map.md)
- [开发风格指南 / Development Style Guide](./docs/overview/development-style.md)
- [部署说明 / Deployment](./docs/operations/deployment.md)
- [运行时打包产物 / Runtime Bundle](./docs/operations/runtime-bundle.md)
