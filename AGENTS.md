# Repository Guidelines

## Read Order

- Start with [docs/README.md](./docs/README.md).
- Read [docs/current/system-status.md](./docs/current/system-status.md) before touching runtime, search, or container orchestration.

## Repo Map

- `chat/`: Vue 3 user-facing app. Most work lands in `chat/src`.
- `admin/`: Vue 3 + Vite admin console. Most work lands in `admin/src/api`, `admin/src/views`, and `admin/src/store`.
- `service/`: NestJS backend. Business logic is in `service/src/modules`, shared code is in `service/src/common`.
- `docs/`: Current repo documentation only. Keep it short and current.

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
