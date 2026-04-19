# PI Workspace Rules

## Read Order

- Start with [README.md](./README.md).
- If the task targets one package, also read that package README when it exists.
- For runtime maintenance, read [docs/operations/pi-maintainer-guide.md](../docs/operations/pi-maintainer-guide.md).

## Hard Rules

- No `any` unless absolutely necessary.
- Check existing type definitions before inventing your own.
- Never use inline or dynamic imports for runtime code or types.
- Keep the runtime generic; product workflows belong outside the default runtime.

## Commands

```bash
cd pi
npm run check
```
