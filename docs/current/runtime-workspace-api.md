# Runtime workspace API current state

This document is the current source of truth for the implemented runtime workbench workspace API. It reflects the editable Monaco workbench after commit `bfe1774`.

## Scope

Implemented first-phase capabilities:

- Runtime workspace file list/read/write/create/rename/delete/search through the OpenWork service.
- Runtime status and OpenSandbox terminal remain available beside the editor.
- Frontend editing is handled by `RuntimeWorkspacePanel.vue`, `RuntimeCodeEditor.vue`, `RuntimeFileExplorer.vue`, and `useRuntimeWorkspaceTabs.ts`.
- Editor models are keyed as `runtime://workspace/{path}`.
- Save is available from the toolbar and `Cmd/Ctrl+S`.
- Clean external updates reload opened tabs; dirty external updates mark tabs as conflicted; deleted clean tabs close.

Not active yet:

- Git UI.
- Debugger.
- Full LSP integration.
- Diff view.
- Auto-save.
- File-tree right-click menus.
- Backend optimistic concurrency enforcement using `baseUpdatedAt`.
- Active backend filtering for search `include`/`exclude`.

## Routing

Business routes are under `/openwork/runtime`. Deployed frontend traffic commonly prefixes these with `/api`, for example `/api/openwork/runtime/workspace/list`.

The API client exports typed wrappers for status, list, read, write, create, rename, delete, and search.

`executeRuntimeCommandAPI` still points to `/openwork/runtime/exec`, but there is currently no matching controller endpoint. Do not document or use it as an active runtime command API.

## Workspace endpoints

### List workspace files

`POST /openwork/runtime/workspace/list`

Request:

```json
{ "groupId": "group-id" }
```

Returns a bounded workspace tree/manifest. The list operation is limited to 2000 files.

### Read file

`POST /openwork/runtime/workspace/read`

Request:

```json
{ "groupId": "group-id", "path": "src/index.ts" }
```

Reads a workspace-relative file. Read content is limited to 1 MiB.

### Write file

`POST /openwork/runtime/workspace/write`

Request:

```json
{
  "groupId": "group-id",
  "path": "src/index.ts",
  "content": "file contents",
  "baseUpdatedAt": "2026-04-30T00:00:00.000Z"
}
```

Response:

```json
{
  "kind": "file",
  "name": "index.ts",
  "path": "src/index.ts",
  "size": 123,
  "type": "text/plain",
  "updatedAt": "2026-04-30T00:00:01.000Z",
  "runId": "runtime-run-id",
  "source": "opensandbox"
}
```

`baseUpdatedAt` is accepted and passed by the frontend, but the backend currently does not enforce optimistic concurrency with it. Current conflict handling is based on frontend polling and tab state.

Write payloads are limited to 2 MiB. Editable files are limited to 1 MiB.

### Create file or directory

`POST /openwork/runtime/workspace/create`

Request:

```json
{
  "groupId": "group-id",
  "path": "src/new-file.ts",
  "content": "optional initial contents",
  "kind": "file"
}
```

`content` and `kind` are optional. The response is entry metadata for the created path.

### Rename file or directory

`POST /openwork/runtime/workspace/rename`

Request:

```json
{
  "groupId": "group-id",
  "fromPath": "src/old.ts",
  "toPath": "src/new.ts"
}
```

Response:

```json
{
  "fromPath": "src/old.ts",
  "toPath": "src/new.ts",
  "entry": {
    "kind": "file",
    "name": "new.ts",
    "path": "src/new.ts",
    "size": 123,
    "type": "text/plain",
    "updatedAt": "2026-04-30T00:00:01.000Z"
  }
}
```

### Delete file or directory

`POST /openwork/runtime/workspace/delete`

Request:

```json
{ "groupId": "group-id", "path": "src/old.ts" }
```

Response:

```json
{
  "deleted": true,
  "path": "src/old.ts",
  "kind": "file",
  "size": 123,
  "type": "text/plain",
  "updatedAt": "2026-04-30T00:00:01.000Z"
}
```

### Search workspace

`POST /openwork/runtime/workspace/search`

Request:

```json
{
  "groupId": "group-id",
  "query": "search text",
  "include": ["src/**"],
  "exclude": ["node_modules/**"]
}
```

Response:

```json
{
  "results": [
    {
      "path": "src/index.ts",
      "matches": [
        { "line": 12, "column": 4, "preview": "const value = 'search text'" }
      ]
    }
  ],
  "truncated": false
}
```

Search limits:

- Files searched: 200 max.
- Matches returned: 1000 max.
- Searchable file size: 1 MiB max.

`include` and `exclude` are accepted in the DTO/client and reserved for future filtering, but the backend currently ignores them.

## Related runtime endpoints

- `POST /openwork/runtime/status`
- `WS /openwork/runtime/terminal`

These are not workspace file APIs, but the workbench uses them to preserve runtime state and terminal access alongside the editor.

## Safety rules

All workspace APIs must preserve these rules:

- Require JWT authentication.
- Only operate for valid project groups.
- Resolve the current user's group runtime through the OpenSandbox runtime service.
- Treat all paths from the frontend as workspace-relative paths.
- Normalize paths against the configured workspace root.
- Reject path traversal and absolute paths outside the workspace.
- Hide and deny all `.openwork` paths.
- Do not expose raw OpenSandbox endpoints to the frontend.
- Reject oversized files and payloads.
- Do not edit binary files in the first-phase editor.
- Perform sandbox file operations through bounded Node filesystem scripts rather than shell-string file manipulation.

## Frontend behavior notes

- `RuntimeWorkspacePanel.vue` owns the current integrated layout and API orchestration.
- `RuntimeCodeEditor.vue` wraps Monaco and emits save on `Cmd/Ctrl+S`.
- `RuntimeFileExplorer.vue` emits refresh/create-file/rename-selected/delete-selected/select-file.
- `useRuntimeWorkspaceTabs.ts` tracks `baseUpdatedAt`, `conflict`, `content`, `dirty`, `savedContent`, and `saving`.
- The workbench keeps preview and terminal available while editing.

## Validation notes

Known post-change validation:

- service runtime workspace spec passed.
- chat tests passed.
- chat type-check still fails due pre-existing unrelated project errors; filtered checks did not show changed workspace component errors.
