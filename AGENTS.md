# Repository Guidelines

## Read Order

- Start with [docs/README.md](./docs/README.md).
- Treat `docs/current/` as the current source of truth for architecture, runtime, workspace API, and operations.
- Read [docs/current/system-status.md](./docs/current/system-status.md) before touching runtime, search, workspace APIs, or container orchestration.
- Treat `docs/superpowers/specs/` and `docs/superpowers/plans/` as design or historical records unless a file is explicitly marked current.

## Repo Map

- `chat/`: Vue 3 user-facing app. Most work lands in `chat/src`.
- `admin/`: Vue 3 + Vite admin console. Most work lands in `admin/src/api`, `admin/src/views`, and `admin/src/store`.
- `service/`: NestJS backend. Business logic is in `service/src/modules`, shared code is in `service/src/common`.
- `docs/`: Current docs in `docs/current/`; specs/plans are design history unless marked current. Keep updates short.

## Working Rules

- Follow local conventions in each module instead of reformatting unrelated files.
- `admin/` and `service/` use semicolon-formatted TypeScript.
- `chat/` keeps its existing no-semicolon style.
- Do not edit generated `dist/` assets directly.

## Common Commands

- `./build.sh`
- `cd admin && pnpm dev`
- `cd chat && pnpm dev`
- `cd service && pnpm dev`
