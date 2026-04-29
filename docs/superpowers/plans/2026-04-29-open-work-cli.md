# Open Work CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first working `openwork` CLI that initializes projects from bundled templates and runs project lifecycle commands inside the sandbox workspace.

**Architecture:** Add an independent Node.js CLI package at `runtime/openwork-cli`. Keep v1 dependency-free so it can be tested immediately with Node's built-in test runner; the template renderer supports the `<%= key %>` interpolation form used by the bundled templates. Store project lifecycle metadata in `.openwork/project.json` and process metadata in `.openwork/runtime.json`.

**Tech Stack:** Node.js ESM, `node:test`, built-in `fs/path/child_process`, shell template scripts.

---

## File Structure

- Create `runtime/openwork-cli/package.json`: package scripts, bin mapping, test command.
- Create `runtime/openwork-cli/bin/openwork.js`: executable CLI entrypoint.
- Create `runtime/openwork-cli/src/cli.js`: argument parsing and command dispatch.
- Create `runtime/openwork-cli/src/output.js`: stable JSON and text output helpers.
- Create `runtime/openwork-cli/src/errors.js`: typed CLI errors and error codes.
- Create `runtime/openwork-cli/src/templateRegistry.js`: load templates and validate params.
- Create `runtime/openwork-cli/src/templateRender.js`: scan, conflict-check, render, and copy template files.
- Create `runtime/openwork-cli/src/projectConfig.js`: read/write `.openwork/project.json` and `.openwork/runtime.json`.
- Create `runtime/openwork-cli/src/runCommand.js`: run lifecycle commands and detached dev process.
- Create `runtime/openwork-cli/templates/*`: bundled v1 templates.
- Create `runtime/openwork-cli/test/*.test.js`: behavior tests.
- Modify `docs/current/system-status.md`: document that project initialization is handled by the container `openwork` CLI.

## Tasks

### Task 1: CLI Registry And Recommendation

**Files:**
- Create: `runtime/openwork-cli/package.json`
- Create: `runtime/openwork-cli/bin/openwork.js`
- Create: `runtime/openwork-cli/src/errors.js`
- Create: `runtime/openwork-cli/src/output.js`
- Create: `runtime/openwork-cli/src/templateRegistry.js`
- Create: `runtime/openwork-cli/src/cli.js`
- Create: `runtime/openwork-cli/templates/templates.json`
- Test: `runtime/openwork-cli/test/templateRegistry.test.js`

- [ ] **Step 1: Write failing tests**

Test `loadTemplates()` lists bundled templates, `templates --json` prints model-facing selection guidance, and the CLI does not expose an internal recommendation command.

- [ ] **Step 2: Run red test**

Run: `cd runtime/openwork-cli && npm test -- templateRegistry.test.js`
Expected: fails because package and modules do not exist.

- [ ] **Step 3: Implement registry and CLI shell**

Implement package metadata, executable bin, output helpers, error helpers, template loading, rich template metadata, and the `templates` command.

- [ ] **Step 4: Run green test**

Run: `cd runtime/openwork-cli && npm test -- templateRegistry.test.js`
Expected: passes.

### Task 2: Template Rendering And Init

**Files:**
- Create: `runtime/openwork-cli/src/templateRender.js`
- Create: `runtime/openwork-cli/src/projectConfig.js`
- Create: `runtime/openwork-cli/templates/native-static/*`
- Create: `runtime/openwork-cli/templates/vite-vue-admin/*`
- Test: `runtime/openwork-cli/test/init.test.js`

- [ ] **Step 1: Write failing tests**

Test `openwork init --template native-static --workspace <tmp> --json` creates `index.html`, `AGENTS.md`, `.openwork/project.json`, and rejects a non-empty workspace unless `--force` is used.

- [ ] **Step 2: Run red test**

Run: `cd runtime/openwork-cli && npm test -- init.test.js`
Expected: fails because init is not implemented.

- [ ] **Step 3: Implement renderer and init command**

Implement workspace checks, file conflict detection, `_gitignore` dotfile conversion, simple `<%= key %>` interpolation, template config loading, project config writing, and JSON output.

- [ ] **Step 4: Run green test**

Run: `cd runtime/openwork-cli && npm test -- init.test.js`
Expected: passes.

### Task 3: Lifecycle Commands

**Files:**
- Create: `runtime/openwork-cli/src/runCommand.js`
- Test: `runtime/openwork-cli/test/lifecycle.test.js`

- [ ] **Step 1: Write failing tests**

Test `openwork build --workspace <tmp> --json` reads `.openwork/project.json`, executes the configured command, writes logs, and returns `COMMAND_FAILED` on non-zero exit.

- [ ] **Step 2: Run red test**

Run: `cd runtime/openwork-cli && npm test -- lifecycle.test.js`
Expected: fails because lifecycle commands are not implemented.

- [ ] **Step 3: Implement lifecycle commands**

Implement `dev`, `build`, `start`, and `status`. Keep `dev/start` foreground by default; use detached process only for `init --dev`.

- [ ] **Step 4: Run green test**

Run: `cd runtime/openwork-cli && npm test -- lifecycle.test.js`
Expected: passes.

### Task 4: Remaining Templates And Docs

**Files:**
- Create: `runtime/openwork-cli/templates/vite-react/*`
- Create: `runtime/openwork-cli/templates/vite-vue/*`
- Create: `runtime/openwork-cli/templates/nextjs/*`
- Modify: `docs/current/system-status.md`

- [ ] **Step 1: Add tests for template coverage**

Extend registry/init tests so each template in `templates.json` has a directory, `template.openwork.json`, and `AGENTS.md`.

- [ ] **Step 2: Run red/green loop**

Run: `cd runtime/openwork-cli && npm test`
Expected: fails before adding missing templates, passes after adding them.

- [ ] **Step 3: Update docs**

Update current system status to say new workspaces are initialized by the container `openwork` CLI with bundled templates.

- [ ] **Step 4: Verify all**

Run: `cd runtime/openwork-cli && npm test`
Run: `node runtime/openwork-cli/bin/openwork.js templates --json`
Run: `node runtime/openwork-cli/bin/openwork.js init smoke-app --template native-static --workspace "$(mktemp -d)" --json`
Expected: all pass and JSON output is valid.
