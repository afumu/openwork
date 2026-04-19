# Repository Guidelines

## Read Order

- Start with [docs/README.md](/Users/apple/workplace-frontend/openwork/docs/README.md).
- Read [docs/current/system-status.md](/Users/apple/workplace-frontend/openwork/docs/current/system-status.md) before touching runtime, runtime bundle, search, or container orchestration.
- If the task touches `pi/`, also read [pi/AGENTS.md](/Users/apple/workplace-frontend/openwork/pi/AGENTS.md).

## Repo Map

- `chat/`: Vue 3 user-facing app. Most work lands in `chat/src`.
- `admin/`: Vue 3 + Vite admin console. Most work lands in `admin/src/api`, `admin/src/views`, and `admin/src/store`.
- `service/`: NestJS backend. Business logic is in `service/src/modules`, shared code is in `service/src/common`.
- `pi/`: Separate npm workspace for agent/runtime packages under `pi/packages/*`.
- `docs/`: Current repo documentation only. Keep it short and current.

## Working Rules

- Follow local conventions in each module instead of reformatting unrelated files.
- `admin/` and `service/` use semicolon-formatted TypeScript.
- `chat/` keeps its existing no-semicolon style.
- `pi/` uses Biome-managed TypeScript with double quotes and semicolons.
- Do not edit generated `dist/` assets directly.

## Common Commands

- `./build.sh`
- `cd admin && pnpm dev`
- `cd chat && pnpm dev`
- `cd service && pnpm dev`
- `cd pi && npm run check`
