# OpenWork

OpenWork 是一个面向组织部署的浏览器智能体平台。
它把聊天工作台、管理后台、产品网关和 OpenSandbox agent runtime 组合成一套可落地的系统：部署完成后，团队只需要创建账号并配置模型，用户就可以直接在 Web 应用里完成对话、工具调用展示、Monaco 工作区编辑、终端和文件交互。

OpenWork is a browser-based agent platform for teams that want a deployable, web-first AI workspace.
It combines a user-facing chat workspace, an admin console, and a backend gateway so teams can deploy once, configure models centrally, and let users work directly in the browser.

## OpenWork 是什么

OpenWork 面向这样一类场景：

- 希望把智能体能力部署到自有环境，而不是只依赖托管产品
- 希望统一模型配置、搜索配置、权限和运行时策略
- 希望用户直接在浏览器里完成对话、工具执行展示和文件交互
- 希望通过 OpenSandbox 接入隔离运行时、openwork CLI 和 CLI agent

从架构上看，OpenWork 不是“单个聊天应用”，而是一套由前端、后端和部署流程共同组成的平台仓库。

## What OpenWork Is

OpenWork is designed for teams that want more than a thin chat UI:

- a browser-based AI workspace for end users
- centralized admin control for models and platform settings
- a backend gateway that owns auth, billing/quota, logging, and routing
- an OpenSandbox runtime layer for isolated CLI agent execution and project workspaces

The repo is intentionally structured as a platform codebase rather than a single product surface.

## Core Capabilities

- Browser-based chat workspace, Monaco runtime workbench, file operations, terminal, and tool execution display
- Centralized admin console for model, search, and platform configuration
- `service` as the product gateway for auth, billing/quota, logs, model dispatch, OpenSandbox runtime routing, and PTY/workspace API proxying
- Generic platform search integration routed through the backend
- `openwork-agent-runtime` image with bridge, Claude Code instructions, and runtime `openwork` CLI

## Architecture

当前主流程如下：

```text
chat frontend
  -> service /api/openwork/*
     -> auth, billing/quota, logs, group state
     -> model provider API
     -> OpenSandbox sandbox
        -> openwork-agent-runtime
           -> openwork-agent-bridge
              -> Claude Code
```

几个关键边界：

- `service/` 仍然是产品网关，并负责 OpenSandbox runtime 定位、bridge 连接、PTY/WebSocket 转发和 workspace API 代理
- 搜索能力通过统一平台接口暴露，而不是在前端散落接入
- 旧的内置 Docker runtime 已移除；项目群组的 Claude/OpenSandbox 模型键进入 OpenSandbox agent runtime
- runtime 镜像是 `openwork-agent-runtime`，内置 bridge、Claude Code 指令和 runtime `openwork` CLI

更详细的当前事实可以查看 [docs/current/system-status.md](./docs/current/system-status.md)。

## Repository Layout

- `chat/`
  用户工作区与聊天界面，基于 Vue 3，负责对话、工具执行展示、Monaco runtime 工作台、终端、文件与工作区交互。

- `admin/`
  管理后台，基于 Vue 3 + Vite，负责模型配置、搜索配置、平台设置与运维入口。

- `service/`
  NestJS 后端，负责鉴权、用量/额度、日志、模型请求、搜索能力、OpenSandbox runtime 路由、终端与 workspace API。

- `docs/`
  当前有效的仓库文档入口，记录系统现状、风格约束和部署说明。

## Quick Start

### 常用命令

```bash
./build.sh
cd admin && pnpm dev
cd chat && pnpm dev
cd service && pnpm dev
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
- 修改前优先阅读 [docs/overview/development-style.md](./docs/overview/development-style.md)
- 不直接编辑生成产物，例如 `dist/`

## What This Repo Includes

- Web-based coding and chat workspace
- Monaco editor runtime workbench with workspace file APIs
- OpenSandbox agent runtime integration through `openwork-agent-runtime`
- Runtime `openwork` CLI packaged in the agent image
- Tool execution display and historical record compatibility
- Generic platform search integration
- Backend product gateway design

## What This Repo Does Not Include

- Product-specific editorial workflows baked into the default runtime
- Fixed multi-stage content pipelines tied to one business scenario
- The old in-repo Docker runtime workspace; runtime execution now happens through OpenSandbox

## 致谢与来源 / Credits

OpenWork 是在 [99AI](https://github.com/vastxie/99AI) 的基础上做了一些改造和扩展。

感谢 99AI 项目为社区提供的基础能力与实践参考。

OpenWork is built by adapting and extending [99AI](https://github.com/vastxie/99AI).

Many thanks to the 99AI project for its open source work, foundational capabilities, and practical reference value.

## Docs

- [文档导览 / Docs Guide](./docs/README.md)
- [开源说明 / Open Source Note](./docs/overview/open-source-note.md)
- [当前系统状态 / Current System Status](./docs/current/system-status.md)
- [OpenSandbox 运行时现状与后续计划 / OpenSandbox Runtime Status and Plan](./docs/current/opensandbox-runtime-plan.md)
- [Runtime workspace API current state](./docs/current/runtime-workspace-api.md)
- [仓库地图 / Repo Map](./docs/overview/repo-map.md)
- [开发风格指南 / Development Style Guide](./docs/overview/development-style.md)
- [部署说明 / Deployment](./docs/operations/deployment.md)
