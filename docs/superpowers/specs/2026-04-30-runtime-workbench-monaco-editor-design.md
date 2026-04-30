# Runtime Workbench Monaco Editor Design

## Goal

Upgrade the chat project's right-side runtime workbench from a read-only file viewer into a practical web IDE surface.

The first version should feel native to OpenWork instead of embedding a separate IDE inside the product. It should preserve the current chat, preview, runtime status, and OpenSandbox terminal experience while adding a full-featured editor workflow around Monaco Editor.

## Current State

The chat workbench already has the right outer shape:

- `RuntimeWorkspacePanel.vue` owns the file tree, editor/preview tabs, runtime status, and terminal split panes.
- `RuntimeFileExplorer.vue` renders workspace files from `runtime/workspace/list`.
- `RuntimeCodeEditor.vue` uses CodeMirror 6 as a read-only single-file viewer.
- `RuntimePreviewPane.vue` renders app preview, markdown, HTML, image, and text previews.
- `RuntimeTerminalPane.vue` connects xterm to the OpenSandbox PTY WebSocket.

The backend currently exposes read-only workspace APIs:

- `POST /api/openwork/runtime/workspace/list`
- `POST /api/openwork/runtime/workspace/read`
- `POST /api/openwork/runtime/status`
- `WS /api/openwork/runtime/terminal`

OpenSandbox is the runtime direction. The service layer must continue to own authentication, user/group sandbox lookup, path normalization, and proxying. The frontend must not receive direct OpenSandbox endpoints.

## Selected Approach

Use Monaco Editor as the editor core and keep the workbench shell in OpenWork.

This gives users the familiar VS Code editing feel, minimap/search/selection behavior, diff support, keyboard shortcuts, and a clear path to language server integration, while avoiding the operational cost of running a full code-server or OpenVSCode instance per sandbox.

CodeMirror remains useful in small modals such as `HtmlDialog.vue`, but the runtime workbench should move to Monaco because this surface is expected to become a real code workspace.

## Alternatives Considered

### Keep CodeMirror 6

Pros:

- Already installed.
- Small bundle and easy Vue integration.
- MIT licensed and highly extensible.

Cons:

- The current implementation is read-only and remounts on every file/content change.
- Building a full IDE experience requires more custom work.
- LSP, diagnostics, multi-file model management, and VS Code-like behavior are less direct than Monaco.

Use only if bundle size becomes the dominant concern.

### Embed code-server or OpenVSCode Server

Pros:

- Closest to a complete VS Code experience.
- Includes file explorer, search, settings, terminal, extensions, and Git UI.

Cons:

- Adds a second IDE shell inside OpenWork's existing product shell.
- Requires per-sandbox IDE process management, routing, auth, resource limits, and lifecycle cleanup.
- Extension marketplace behavior differs from Microsoft VS Code builds.
- Harder to integrate with OpenWork-specific chat, agent, preview, deploy, and billing workflows.

Keep this as a later "Open in full IDE" advanced mode, not the default embedded workbench.

### Adopt Eclipse Theia

Pros:

- Mature open source cloud IDE framework.
- Good for white-label IDE products and custom domain-specific tools.

Cons:

- Too heavy for the current goal.
- Would shift the project toward building a separate IDE platform instead of improving the chat workbench.

Do not use for the first implementation.

## Product Scope

### Phase 1: Editable Monaco Workbench

The first implementation should deliver:

- Monaco-based editor replacing `RuntimeCodeEditor.vue`.
- Multiple open file tabs.
- Dirty-state tracking per tab.
- Save with toolbar button and `Cmd/Ctrl+S`.
- Refresh/reload behavior when runtime files change.
- File create, update, rename, delete through OpenWork service APIs.
- Safe path handling: paths remain workspace-relative, normalized server-side, and cannot escape `/workspace`.
- Existing app/file preview remains in `RuntimePreviewPane.vue`.
- Existing terminal remains in `RuntimeTerminalPane.vue`.

Non-goals for phase 1:

- VS Code extensions.
- Full Git UI.
- Debugger.
- Multi-user collaboration.
- Full language server integration.

### Phase 2: IDE Workflow Polish

Add after the editor/write path is stable:

- Workspace text search.
- Diff view for external changes or agent-written edits.
- Better file icons and empty states.
- Context menu for file tree operations.
- Rename/create/delete confirmations.
- Optional autosave setting.
- Split editor or preview side-by-side mode if layout pressure allows.

### Phase 3: Language Intelligence

Add language services incrementally:

- Built-in Monaco TypeScript/JavaScript support first.
- JSON/CSS/HTML diagnostics next.
- Optional LSP bridge through `monaco-languageclient` for Python or other server-backed languages.
- Language servers should run inside the sandbox or a controlled service-side process, reached through authenticated service WebSocket endpoints.

## Architecture

### Frontend Components

Create a clearer editor boundary:

- `RuntimeWorkspacePanel.vue`
  - Owns high-level layout and runtime polling.
  - Owns active workbench mode: editor, preview, terminal/info panels.
  - Delegates file-tab state to a composable.

- `RuntimeMonacoEditor.vue`
  - Wraps Monaco lifecycle.
  - Accepts active tab model and readonly/dirty/saving state.
  - Emits content changes, save commands, and editor-ready events.

- `RuntimeEditorTabs.vue`
  - Shows open files.
  - Marks dirty tabs.
  - Supports close and select.

- `RuntimeFileExplorer.vue`
  - Keeps tree rendering.
  - Adds create, rename, delete events.

- `useRuntimeWorkspaceTabs.ts`
  - Manages open tabs, active path, loaded file metadata, dirty state, and conflict state.

- `useRuntimeWorkspaceFiles.ts`
  - Wraps list/read/write/create/delete/search API calls and normalization helpers.

The panel should avoid becoming a large controller file. Editing state and file operations should move into composables as the workbench grows.

### Backend APIs

Add service-owned endpoints:

- `POST /api/openwork/runtime/workspace/write`
  - Input: `groupId`, `path`, `content`, optional `baseUpdatedAt`.
  - Writes a UTF-8 text file.
  - Returns updated file metadata and conflict information if the base revision is stale.

- `POST /api/openwork/runtime/workspace/create`
  - Input: `groupId`, `path`, optional `content`, optional `kind`.
  - Creates a file or directory.

- `POST /api/openwork/runtime/workspace/rename`
  - Input: `groupId`, `fromPath`, `toPath`.

- `POST /api/openwork/runtime/workspace/delete`
  - Input: `groupId`, `path`.

- `POST /api/openwork/runtime/workspace/search`
  - Input: `groupId`, `query`, optional include/exclude globs.
  - Returns bounded matches with truncation metadata.

Each endpoint must:

- Require JWT auth.
- Verify the group is a project group.
- Resolve the current user/group sandbox through OpenSandbox runtime service.
- Normalize and validate paths against the configured workspace root.
- Reject path traversal, absolute paths outside workspace, huge payloads, and binary write attempts.
- Return localized, user-safe errors through the existing response shape.

### OpenSandbox File Operations

The existing runtime service already runs bounded Node scripts inside the sandbox for list/read. Extend that pattern for write/create/rename/delete/search.

Use Node filesystem APIs inside the sandbox rather than shell string manipulation. Continue passing arguments separately and quoting command strings with existing helpers.

Recommended limits:

- Maximum editable text file size: 1 MB for phase 1.
- Maximum write payload: 2 MB.
- Maximum list result: keep existing bounded list behavior.
- Maximum search matches: 200 files or 1000 line matches, whichever comes first.

Binary files should remain preview/download-only in phase 1.

## Data Flow

### Open File

1. User selects a file in the tree.
2. Frontend opens an existing tab if present.
3. If absent, frontend calls `workspace/read`.
4. `useRuntimeWorkspaceTabs` creates a Monaco model keyed by path.
5. Active tab becomes editable unless the file is binary, too large, or truncated.

### Save File

1. User presses `Cmd/Ctrl+S` or clicks save.
2. Frontend sends `workspace/write` with current content and `baseUpdatedAt`.
3. Backend validates path and writes into the sandbox workspace.
4. Backend returns new `updatedAt`, size, type, and path.
5. Frontend clears dirty state and refreshes manifest.
6. Preview iframe/markdown pane reloads if the saved file is currently previewed.

### External Change

Agent or terminal commands may update files while a tab is open.

When polling detects a newer `updatedAt` for an open clean tab, refresh the tab silently. When the tab is dirty, show a conflict state with actions:

- Keep my changes.
- Reload from workspace.
- View diff.

Phase 1 can implement keep/reload and reserve diff for phase 2.

## UX Rules

- The workbench stays visually integrated with chat.
- Editor, preview, and terminal should remain visible through split panes.
- Save status should be explicit but quiet: dirty dot, saving spinner, saved timestamp, or short toolbar message.
- Destructive file actions require confirmation.
- The UI must remain usable when no runtime exists yet: show a clear empty state and allow refresh.
- The user should never see raw OpenSandbox endpoints or internal sandbox metadata unless opening the info panel.

## Error Handling

Handle these cases explicitly:

- Runtime does not exist yet.
- Workspace list/read/write command fails.
- File was deleted while open.
- File changed outside the editor.
- File is too large or binary.
- Path is invalid or escapes the workspace.
- Sandbox is stopped or expired.

Frontend errors should be shown in the existing toolbar/error strip style, with retry where useful.

## Testing

### Frontend

Add focused tests for:

- Tab state and dirty state transitions.
- Save command calls the correct API.
- External clean-tab updates refresh content.
- External dirty-tab updates enter conflict state.
- File tree actions emit create/rename/delete events.
- Existing project-mode tests continue to show the workbench only for project groups.

### Backend

Add service/runtime tests for:

- Write creates/updates files.
- Create directory and file behavior.
- Rename and delete behavior.
- Path traversal rejection.
- Payload size rejection.
- Missing runtime behavior.
- Search truncation behavior.

### Manual Verification

Run:

- `cd chat && pnpm test`
- `cd chat && pnpm type-check`
- relevant service tests for runtime workspace APIs

Then verify in browser:

- Open project group.
- Open multiple files.
- Edit and save.
- Confirm preview updates.
- Create, rename, delete a file.
- Use terminal to edit a file and confirm external-change handling.

## References

- Monaco Editor: https://github.com/microsoft/monaco-editor
- CodeMirror: https://codemirror.net/
- monaco-languageclient: https://github.com/TypeFox/monaco-languageclient
- monaco-vscode-api: https://github.com/CodinGame/monaco-vscode-api
- code-server: https://github.com/coder/code-server
- OpenVSCode Server: https://github.com/gitpod-io/openvscode-server
- Eclipse Theia: https://projects.eclipse.org/projects/ecd.theia
