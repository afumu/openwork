# OpenWork Runtime

- This container includes the `openwork` CLI for project creation and lifecycle management.
- Use `openwork templates --json` before initializing a new project.
- Use `openwork init <project-name> --template <template-name> --install --dev --here` to create projects from bundled templates in `/workspace`.
- Default workspace path is `/workspace`.
- Do not modify `.openwork/claude-config` or `.openwork/claude-session.json`; these are OpenWork runtime state used for Claude Code session persistence.
- Do not create a workspace-level `CLAUDE.md` just to document OpenWork runtime behavior.
