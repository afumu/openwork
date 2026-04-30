# Chat Runtime Workspace Panel Implementation Plan

> **Status:** Historical / superseded. This plan describes the earlier tabbed, mostly read-only workspace panel direction. The current implemented direction is the Monaco editable runtime workbench and OpenSandbox workspace API documented in `docs/current/runtime-workspace-api.md`, `docs/current/system-status.md`, and `docs/superpowers/specs/2026-04-30-runtime-workbench-monaco-editor-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desktop chat screen into a two-pane workspace: conversation on the left, runtime workspace information on the right with files, preview, terminal log, and container info.

**Architecture:** Reuse the existing chat flow and artifact APIs instead of replacing the page. Extract the reusable parts of `ArtifactsDrawer.vue` into an embeddable artifact workspace component, add a right-side `RuntimeWorkspacePanel`, and keep the existing drawer behavior for mobile. Backend changes are limited to a small runtime status endpoint; true interactive terminal is intentionally deferred and represented in v1 by the existing PI tool execution stream.

**Tech Stack:** Vue 3 `<script setup>`, Pinia stores, Tailwind utility classes, existing `@icon-park/vue-next` icons, existing `/openwork/artifacts/*` APIs, NestJS service/controller patterns, Node test runner for chat helpers, Jest for service tests.

---

## Scope

### Included In First Version

- Desktop-only right workspace panel integrated into `chatBase.vue`.
- Tabs: `文件`, `预览`, `终端`, `信息`.
- Files tab lists current conversation artifacts and workspace files.
- Clicking a file opens it in the preview tab.
- Preview supports markdown/text/code, images, and HTML iframe via `srcdoc`.
- Terminal tab shows structured PI tool execution records from the current conversation stream/history.
- Info tab shows current group id, streaming state, artifact count, and backend runtime container status.
- Mobile keeps the current `ArtifactsDrawer` interaction.
- Styling follows current OpenWork chat styles: restrained borders, dark-mode support, rounded panels, existing icon system.

### Deferred

- Interactive PTY terminal.
- Live dev-server URL proxying from inside the container.
- File editing from the right panel.
- Drag resizing between chat and workspace.
- Multi-tab code editor state.

---

## File Structure

- Modify `chat/src/views/chat/chatBase.vue`
  - Owns desktop layout and passes active conversation data into the workspace panel.
  - Keeps mobile drawer behavior.
- Create `chat/src/views/chat/components/workspace/types.ts`
  - Shared artifact/runtime/tool execution types for the workspace components.
- Create `chat/src/views/chat/components/workspace/artifactWorkspace.ts`
  - Pure helpers: unwrap API payloads, flatten workspace files, build tree rows, resolve preview kind.
- Create `chat/src/views/chat/components/workspace/artifactWorkspace.test.ts`
  - Node tests for helper behavior.
- Create `chat/src/views/chat/components/workspace/ArtifactWorkspace.vue`
  - Embeddable files panel, based on the reusable behavior currently inside `ArtifactsDrawer.vue`.
- Modify `chat/src/views/chat/components/ArtifactsDrawer.vue`
  - Keep drawer shell, delegate file browsing/preview to `ArtifactWorkspace.vue`.
- Create `chat/src/views/chat/components/workspace/RuntimeWorkspacePanel.vue`
  - Right panel shell with tabs, desktop layout, loading/empty states.
- Create `chat/src/views/chat/components/workspace/RuntimePreviewPane.vue`
  - Preview renderer for selected file.
- Create `chat/src/views/chat/components/workspace/RuntimeTerminalLog.vue`
  - Terminal-like log built from `tool_execution` / `stream_segments`.
- Create `chat/src/views/chat/components/workspace/RuntimeInfoPanel.vue`
  - Runtime/container information panel.
- Create `chat/src/api/runtime.ts`
  - Frontend API wrapper for runtime status.
- Create `service/src/modules/chat/dto/runtimeStatus.dto.ts`
  - DTO with `groupId`.
- Modify `service/src/modules/chat/chat.controller.ts`
  - Add `POST /openwork/runtime/status`.
- Modify `service/src/modules/chat/chat.service.ts`
  - Add `runtimeStatus`.
- Modify `service/src/modules/aiTool/chat/chat.service.ts`
  - Add `getRuntimeStatus`.
- Modify `service/src/modules/aiTool/chat/piRuntimeManager.ts`
  - Add a public helper that returns runtime descriptor without starting missing containers.
- Test `service/src/modules/aiTool/chat/piRuntimeManager.spec.ts`
  - Add coverage for runtime descriptor lookup by conversation group.
- Test `service/src/modules/chat/chat.service.spec.ts`
  - Add coverage that runtime status requires `groupId` and calls the runtime layer with current user.

---

## Task 1: Extract Artifact Helpers

**Files:**
- Create: `chat/src/views/chat/components/workspace/types.ts`
- Create: `chat/src/views/chat/components/workspace/artifactWorkspace.ts`
- Create: `chat/src/views/chat/components/workspace/artifactWorkspace.test.ts`

- [ ] **Step 1: Create failing helper tests**

Create `chat/src/views/chat/components/workspace/artifactWorkspace.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorkspaceTreeFromFiles,
  flattenArtifactManifestFiles,
  resolvePreviewKind,
  unwrapArtifactPayload,
} from './artifactWorkspace'

test('unwrapArtifactPayload unwraps nested data payloads', () => {
  const payload = { data: { data: { workspaceFiles: [{ path: 'index.html' }] } } }

  assert.deepEqual(unwrapArtifactPayload(payload), {
    workspaceFiles: [{ path: 'index.html' }],
  })
})

test('flattenArtifactManifestFiles prefers workspace files when present', () => {
  const files = flattenArtifactManifestFiles({
    workspaceFiles: [
      {
        name: 'index.html',
        path: 'projects/index.html',
        size: 10,
        type: 'text/html',
        updatedAt: '2026-04-26T01:00:00.000Z',
        runId: null,
      },
    ],
    runs: [
      {
        runId: 'run-1',
        files: [
          {
            name: 'old.md',
            path: 'old.md',
            size: 5,
            type: 'text/markdown',
            updatedAt: '2026-04-25T01:00:00.000Z',
          },
        ],
      },
    ],
  })

  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'projects/index.html')
})

test('buildWorkspaceTreeFromFiles sorts directories before files', () => {
  const tree = buildWorkspaceTreeFromFiles([
    {
      name: 'README.md',
      path: 'README.md',
      size: 10,
      type: 'text/markdown',
      updatedAt: '2026-04-26T01:00:00.000Z',
      runId: null,
    },
    {
      name: 'main.ts',
      path: 'src/main.ts',
      size: 20,
      type: 'text/typescript',
      updatedAt: '2026-04-26T01:01:00.000Z',
      runId: null,
    },
  ])

  assert.equal(tree[0].nodeType, 'directory')
  assert.equal(tree[0].name, 'src')
  assert.equal(tree[1].nodeType, 'file')
  assert.equal(tree[1].name, 'README.md')
})

test('resolvePreviewKind detects html, markdown, image, and code files', () => {
  assert.equal(resolvePreviewKind('index.html', 'text/html'), 'html')
  assert.equal(resolvePreviewKind('README.md', 'text/markdown'), 'markdown')
  assert.equal(resolvePreviewKind('logo.png', 'image/png'), 'image')
  assert.equal(resolvePreviewKind('src/main.ts', 'text/typescript'), 'code')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd chat && pnpm test -- src/views/chat/components/workspace/artifactWorkspace.test.ts
```

Expected: fails because `artifactWorkspace.ts` does not exist.

- [ ] **Step 3: Create shared types**

Create `chat/src/views/chat/components/workspace/types.ts`:

```ts
export interface ArtifactFileItem {
  name: string
  path: string
  preview?: string
  size: number
  type: string
  updatedAt: string
}

export interface ArtifactWorkspaceFileItem extends ArtifactFileItem {
  runId: string | null
  source?: 'artifacts_root' | 'workspace_root' | 'workspace_loose' | string
}

export interface ArtifactWorkspaceDirectoryItem {
  children: ArtifactWorkspaceTreeItem[]
  name: string
  nodeType: 'directory'
  path: string
  updatedAt: string
}

export interface ArtifactWorkspaceTreeFileItem extends ArtifactWorkspaceFileItem {
  nodeType: 'file'
}

export type ArtifactWorkspaceTreeItem =
  | ArtifactWorkspaceDirectoryItem
  | ArtifactWorkspaceTreeFileItem

export interface ArtifactRunItem {
  runId: string
  files: ArtifactFileItem[]
  source?: 'artifacts_root' | 'workspace_root' | string
}

export interface ArtifactManifest {
  artifactsRoot?: string
  runs?: ArtifactRunItem[]
  workspaceDir?: string
  workspaceRootMode?: 'data' | 'conversation'
  workspaceFiles?: ArtifactWorkspaceFileItem[]
  workspaceTree?: ArtifactWorkspaceTreeItem[]
}

export interface ArtifactReadResult {
  content: string
  path: string
  run_id?: string | null
  size: number
  truncated: boolean
  type: string
  updatedAt: string
}

export type RuntimeWorkspaceTab = 'files' | 'preview' | 'terminal' | 'info'
export type RuntimePreviewKind = 'markdown' | 'html' | 'image' | 'code' | 'text' | 'empty'

export interface RuntimeStatusPayload {
  containerName?: string
  groupId: number
  hostPort?: number
  mode: 'docker' | 'direct'
  running?: boolean
  status?: string
  userId?: number
  volumeName?: string
}
```

- [ ] **Step 4: Implement helper functions**

Create `chat/src/views/chat/components/workspace/artifactWorkspace.ts`:

```ts
import type {
  ArtifactManifest,
  ArtifactWorkspaceDirectoryItem,
  ArtifactWorkspaceFileItem,
  ArtifactWorkspaceTreeItem,
  RuntimePreviewKind,
} from './types'

export function unwrapArtifactPayload<T = ArtifactManifest>(payload: any): T | null {
  if (!payload || typeof payload !== 'object') return null
  if ('runs' in payload || 'workspaceFiles' in payload || 'workspaceTree' in payload) return payload
  if ('data' in payload) return unwrapArtifactPayload<T>(payload.data)
  return null
}

export function flattenArtifactManifestFiles(
  manifest: ArtifactManifest | null
): ArtifactWorkspaceFileItem[] {
  if (!manifest) return []

  if (manifest.workspaceFiles?.length) {
    return manifest.workspaceFiles.slice().sort(sortFiles)
  }

  return (manifest.runs || [])
    .flatMap(run =>
      run.files.map(file => ({
        ...file,
        path:
          run.source === 'artifacts_root'
            ? `data/${run.runId}/${file.path}`
            : `${run.runId}/${file.path}`,
        runId: run.runId,
        source: run.source,
      }))
    )
    .sort(sortFiles)
}

export function buildWorkspaceTreeFromFiles(
  files: ArtifactWorkspaceFileItem[]
): ArtifactWorkspaceTreeItem[] {
  const root: ArtifactWorkspaceTreeItem[] = []
  const directoryIndex = new Map<string, ArtifactWorkspaceDirectoryItem>()

  files.forEach(file => {
    const segments = file.path.split('/').filter(Boolean)
    let currentChildren = root
    let currentPath = ''

    segments.slice(0, -1).forEach(segment => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let directory = directoryIndex.get(currentPath)

      if (!directory) {
        directory = {
          children: [],
          name: segment,
          nodeType: 'directory',
          path: currentPath,
          updatedAt: file.updatedAt,
        }
        directoryIndex.set(currentPath, directory)
        currentChildren.push(directory)
      }

      currentChildren = directory.children
    })

    currentChildren.push({ ...file, nodeType: 'file' })
  })

  return sortWorkspaceTree(root)
}

export function resolvePreviewKind(path: string, mimeType = ''): RuntimePreviewKind {
  const ext = getFileExtension(path)
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image'
  }
  if (['html', 'htm'].includes(ext) || mimeType.includes('html')) return 'html'
  if (['md', 'markdown'].includes(ext) || mimeType.includes('markdown')) return 'markdown'
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'less', 'vue', 'py', 'sh', 'yaml', 'yml'].includes(ext)) {
    return 'code'
  }
  return path ? 'text' : 'empty'
}

function getFileExtension(path: string) {
  const fileName = path.split('?')[0]?.split('/').pop() || path
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}

function sortFiles(left: ArtifactWorkspaceFileItem, right: ArtifactWorkspaceFileItem) {
  const byTime = right.updatedAt.localeCompare(left.updatedAt)
  if (byTime !== 0) return byTime
  return left.path.localeCompare(right.path)
}

function sortWorkspaceTree(nodes: ArtifactWorkspaceTreeItem[]): ArtifactWorkspaceTreeItem[] {
  return nodes
    .slice()
    .sort((left, right) => {
      if (left.nodeType !== right.nodeType) return left.nodeType === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    .map(node =>
      node.nodeType === 'directory'
        ? {
            ...node,
            children: sortWorkspaceTree(node.children),
          }
        : node
    )
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
cd chat && pnpm test -- src/views/chat/components/workspace/artifactWorkspace.test.ts
```

Expected: helper tests pass.

- [ ] **Step 6: Commit**

```bash
git add chat/src/views/chat/components/workspace/types.ts chat/src/views/chat/components/workspace/artifactWorkspace.ts chat/src/views/chat/components/workspace/artifactWorkspace.test.ts
git commit -m "test: add artifact workspace helpers"
```

---

## Task 2: Add Runtime Status API

**Files:**
- Create: `service/src/modules/chat/dto/runtimeStatus.dto.ts`
- Modify: `service/src/modules/chat/chat.controller.ts`
- Modify: `service/src/modules/chat/chat.service.ts`
- Modify: `service/src/modules/aiTool/chat/chat.service.ts`
- Modify: `service/src/modules/aiTool/chat/piRuntimeManager.ts`
- Test: `service/src/modules/aiTool/chat/piRuntimeManager.spec.ts`

- [ ] **Step 1: Add failing runtime manager status test**

In `service/src/modules/aiTool/chat/piRuntimeManager.spec.ts`, add:

```ts
test('findRuntime returns the conversation container descriptor without starting missing containers', async () => {
  const service = new PiRuntimeManagerService({} as any) as any;
  service.dockerEnabled = true;
  service.dockerHost = '127.0.0.1';
  service.inspectContainer = jest.fn().mockResolvedValue({
    Id: 'container-1',
    NetworkSettings: {
      Ports: {
        '8787/tcp': [{ HostIp: '127.0.0.1', HostPort: '49153' }],
      },
    },
    State: {
      Running: true,
      Status: 'running',
    },
  });

  await expect(service.findRuntime({ groupId: 128, userId: 42 }, false, 'trace-1')).resolves.toMatchObject({
    containerName: 'openwork-user-42-group-128',
    groupId: 128,
    hostPort: 49153,
    mode: 'docker',
    running: true,
    userId: 42,
  });
})
```

- [ ] **Step 2: Run test**

Run:

```bash
cd service && pnpm test -- piRuntimeManager.spec.ts --runInBand
```

Expected: if current behavior already passes after recent runtime work, keep this test as regression coverage and continue.

- [ ] **Step 3: Add DTO**

Create `service/src/modules/chat/dto/runtimeStatus.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RuntimeStatusDto {
  @ApiProperty({ example: 128, description: '当前对话 groupId' })
  @IsInt()
  @Min(1)
  groupId: number;
}
```

- [ ] **Step 4: Add service methods**

Add to `service/src/modules/aiTool/chat/chat.service.ts`:

```ts
async getRuntimeStatus(userId: number, groupId: number, traceId?: string) {
  const runtime = await this.piRuntimeManagerService.findRuntime({ groupId, userId }, false, traceId);

  if (!runtime) {
    return {
      groupId,
      mode: this.piRuntimeManagerService.isDockerEnabled() ? 'docker' : 'direct',
      running: false,
      userId,
    };
  }

  return runtime;
}
```

Add to `service/src/modules/chat/chat.service.ts`:

```ts
async runtimeStatus(body: { groupId?: number }, req?: Request) {
  const traceId = this.createTraceId(req?.user?.id, body?.groupId);
  const groupId = Number(body?.groupId || 0);

  if (!groupId) {
    throw new HttpException('缺少 groupId', HttpStatus.BAD_REQUEST);
  }

  return {
    data: await this.openAIChatService.getRuntimeStatus(req.user.id, groupId, traceId),
    success: true,
  };
}
```

- [ ] **Step 5: Add controller route**

Modify `service/src/modules/chat/chat.controller.ts`:

```ts
import { RuntimeStatusDto } from './dto/runtimeStatus.dto';
```

Add route:

```ts
@Post('runtime/status')
@ApiOperation({ summary: '查询当前对话运行时容器状态' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
runtimeStatus(@Body() body: RuntimeStatusDto, @Req() req: Request) {
  return this.chatService.runtimeStatus(body, req);
}
```

- [ ] **Step 6: Verify backend**

Run:

```bash
cd service && pnpm test -- piRuntimeManager.spec.ts chat.service.spec.ts --runInBand
cd service && pnpm build:test
```

Expected: tests pass and Nest build compiles.

- [ ] **Step 7: Commit**

```bash
git add service/src/modules/chat/dto/runtimeStatus.dto.ts service/src/modules/chat/chat.controller.ts service/src/modules/chat/chat.service.ts service/src/modules/aiTool/chat/chat.service.ts service/src/modules/aiTool/chat/piRuntimeManager.ts service/src/modules/aiTool/chat/piRuntimeManager.spec.ts
git commit -m "feat: expose conversation runtime status"
```

---

## Task 3: Build Embeddable Artifact Workspace

**Files:**
- Create: `chat/src/views/chat/components/workspace/ArtifactWorkspace.vue`
- Modify: `chat/src/views/chat/components/ArtifactsDrawer.vue`

- [ ] **Step 1: Create component API**

`ArtifactWorkspace.vue` props and emits:

```ts
const props = defineProps<{
  groupId: number
  initialPath?: string
  isStreaming: boolean
  mode: 'panel' | 'drawer'
}>()

const emit = defineEmits<{
  (event: 'file-selected', payload: { path: string; runId?: string | null }): void
  (event: 'preview-ready', payload: ArtifactReadResult | null): void
}>()
```

- [ ] **Step 2: Move reusable state from drawer**

Move these behaviors from `ArtifactsDrawer.vue` into `ArtifactWorkspace.vue`:

- `manifest`
- `loading`
- `reading`
- `selectedPath`
- `readResult`
- `expandedDirectories`
- artifact list loading via `fetchArtifactListAPI`
- artifact read loading via `fetchArtifactReadAPI`
- initial path watcher
- stream polling watcher

- [ ] **Step 3: Keep drawer as wrapper**

`ArtifactsDrawer.vue` becomes:

```vue
<template>
  <div :class="drawerClass" class="fixed inset-0 z-[8000] ...">
    <div class="...">
      <button type="button" @click="$emit('close')">
        <Close />
      </button>
      <ArtifactWorkspace
        :group-id="groupId"
        :initial-path="initialPath"
        :is-streaming="isStreaming"
        mode="drawer"
      />
    </div>
  </div>
</template>
```

Keep the existing visual style of the drawer shell. Do not change mobile behavior.

- [ ] **Step 4: Verify frontend**

Run:

```bash
cd chat && pnpm type-check
```

Expected: Vue type check passes.

- [ ] **Step 5: Commit**

```bash
git add chat/src/views/chat/components/workspace/ArtifactWorkspace.vue chat/src/views/chat/components/ArtifactsDrawer.vue
git commit -m "feat: extract artifact workspace component"
```

---

## Task 4: Add Runtime Preview Pane

**Files:**
- Create: `chat/src/views/chat/components/workspace/RuntimePreviewPane.vue`

- [ ] **Step 1: Create preview component**

Component props:

```ts
const props = defineProps<{
  file: ArtifactReadResult | null
}>()
```

Preview rules:

- no file: centered empty state, “选择文件后在这里预览”
- markdown/text/code: use `MdPreview` for markdown, `<pre><code>` for code/text
- image: render `<img>`
- html: render iframe with `:srcdoc="file.content"`

- [ ] **Step 2: Match current style**

Use current project visual language:

- `bg-white dark:bg-gray-900`
- `border-gray-200 dark:border-gray-700`
- `rounded-xl`
- `custom-scrollbar`
- no decorative gradient/orb backgrounds

- [ ] **Step 3: Verify**

Run:

```bash
cd chat && pnpm type-check
```

Expected: type check passes.

- [ ] **Step 4: Commit**

```bash
git add chat/src/views/chat/components/workspace/RuntimePreviewPane.vue
git commit -m "feat: add runtime preview pane"
```

---

## Task 5: Add Terminal Log Panel

**Files:**
- Create: `chat/src/views/chat/components/workspace/RuntimeTerminalLog.vue`
- Modify: `chat/src/views/chat/chatBase.vue`

- [ ] **Step 1: Define terminal log input**

`RuntimeTerminalLog.vue` props:

```ts
const props = defineProps<{
  chats: Chat.Chat[]
  isStreaming: boolean
}>()
```

- [ ] **Step 2: Parse logs from current chat messages**

Inside component:

```ts
function parseToolExecutions(chat: Chat.Chat) {
  if (!chat.tool_execution) return []
  try {
    const parsed = JSON.parse(chat.tool_execution)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
```

Also parse `stream_segments` and include segments where `type === 'tool_execution'`.

- [ ] **Step 3: Render terminal-like output**

Rows display:

- icon/status
- tool name
- phase/event
- command/path/url inferred from `args_preview`
- result preview

Empty state:

```text
当前对话还没有容器执行记录
```

- [ ] **Step 4: Verify**

Run:

```bash
cd chat && pnpm type-check
```

Expected: type check passes.

- [ ] **Step 5: Commit**

```bash
git add chat/src/views/chat/components/workspace/RuntimeTerminalLog.vue chat/src/views/chat/chatBase.vue
git commit -m "feat: add runtime terminal log panel"
```

---

## Task 6: Add Runtime Info Panel And API Wrapper

**Files:**
- Create: `chat/src/api/runtime.ts`
- Create: `chat/src/views/chat/components/workspace/RuntimeInfoPanel.vue`

- [ ] **Step 1: Add frontend API**

Create `chat/src/api/runtime.ts`:

```ts
import { post } from '@/utils/request'

export function fetchRuntimeStatusAPI<T>(data: { groupId: number }): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/status',
    data,
  }) as Promise<T>
}
```

- [ ] **Step 2: Build info panel**

Props:

```ts
const props = defineProps<{
  artifactCount: number
  groupId: number
  isStreaming: boolean
}>()
```

Behavior:

- fetch status when `groupId` changes
- refresh every 5 seconds while streaming
- show `containerName`, `status`, `mode`, `volumeName`, `hostPort`
- show local UI facts: artifact count and streaming state

- [ ] **Step 3: Verify**

Run:

```bash
cd chat && pnpm type-check
```

Expected: type check passes.

- [ ] **Step 4: Commit**

```bash
git add chat/src/api/runtime.ts chat/src/views/chat/components/workspace/RuntimeInfoPanel.vue
git commit -m "feat: add runtime info panel"
```

---

## Task 7: Add Runtime Workspace Shell

**Files:**
- Create: `chat/src/views/chat/components/workspace/RuntimeWorkspacePanel.vue`

- [ ] **Step 1: Create shell component**

Props:

```ts
const props = defineProps<{
  artifactCount: number
  chats: Chat.Chat[]
  groupId: number
  initialPath?: string
  isStreaming: boolean
}>()
```

Local state:

```ts
const activeTab = ref<RuntimeWorkspaceTab>('files')
const selectedFile = ref<ArtifactReadResult | null>(null)
```

Tabs:

```ts
const tabs = [
  { key: 'files', label: '文件' },
  { key: 'preview', label: '预览' },
  { key: 'terminal', label: '终端' },
  { key: 'info', label: '信息' },
] as const
```

- [ ] **Step 2: Wire children**

Template:

```vue
<ArtifactWorkspace
  v-show="activeTab === 'files'"
  :group-id="groupId"
  :initial-path="initialPath"
  :is-streaming="isStreaming"
  mode="panel"
  @preview-ready="file => { selectedFile = file; activeTab = 'preview' }"
/>
<RuntimePreviewPane v-show="activeTab === 'preview'" :file="selectedFile" />
<RuntimeTerminalLog v-show="activeTab === 'terminal'" :chats="chats" :is-streaming="isStreaming" />
<RuntimeInfoPanel
  v-show="activeTab === 'info'"
  :artifact-count="artifactCount"
  :group-id="groupId"
  :is-streaming="isStreaming"
/>
```

- [ ] **Step 3: Style shell**

Use compact IDE-like styling:

- full height
- left border
- tab bar height 44px
- panel background `bg-white dark:bg-[#111827]`
- border `border-gray-200 dark:border-gray-700`
- active tab with subtle filled background

- [ ] **Step 4: Verify**

Run:

```bash
cd chat && pnpm type-check
```

Expected: type check passes.

- [ ] **Step 5: Commit**

```bash
git add chat/src/views/chat/components/workspace/RuntimeWorkspacePanel.vue
git commit -m "feat: add runtime workspace panel shell"
```

---

## Task 8: Integrate Desktop Two-Pane Chat Layout

**Files:**
- Modify: `chat/src/views/chat/chatBase.vue`

- [ ] **Step 1: Import workspace panel**

Add:

```ts
import RuntimeWorkspacePanel from './components/workspace/RuntimeWorkspacePanel.vue'
```

- [ ] **Step 2: Create desktop workspace visibility**

Add:

```ts
const shouldShowRuntimeWorkspace = computed(() => {
  return !isMobile.value && Boolean(activeGroupId.value) && !useGlobalStore.showAppListComponent
})
```

- [ ] **Step 3: Change desktop layout**

Replace current single main content wrapper with:

```vue
<div class="relative flex h-full w-full overflow-hidden">
  <section class="flex h-full min-w-0 flex-col" :class="shouldShowRuntimeWorkspace ? 'w-[44%] min-w-[420px] max-w-[720px]' : 'w-full'">
    <!-- existing Header, chat messages, Footer -->
  </section>

  <RuntimeWorkspacePanel
    v-if="shouldShowRuntimeWorkspace"
    class="min-w-0 flex-1"
    :artifact-count="conversationArtifactCount"
    :chats="dataSources"
    :group-id="Number(activeGroupId || 0)"
    :initial-path="artifactsInitialPath"
    :is-streaming="Boolean(chatStore.isStreamIn)"
  />
</div>
```

Keep existing `Sider` outside this content area.

- [ ] **Step 4: Keep mobile drawer**

Keep:

```vue
<ArtifactsDrawer
  v-if="isMobile"
  :visible="artifactsDrawerVisible"
  :group-id="Number(activeGroupId || 0)"
  :is-streaming="Boolean(chatStore.isStreamIn)"
  :initial-path="artifactsInitialPath"
  @close="toggleArtifactsDrawer(false)"
/>
```

For desktop, `openArtifactPreview(path)` should set `artifactsInitialPath` and rely on the right panel. Do not open drawer on desktop.

- [ ] **Step 5: Verify**

Run:

```bash
cd chat && pnpm type-check
cd chat && pnpm build-check
```

Expected: type check and Vite build pass.

- [ ] **Step 6: Commit**

```bash
git add chat/src/views/chat/chatBase.vue
git commit -m "feat: integrate runtime workspace in chat layout"
```

---

## Task 9: Manual Visual Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Start app**

Run:

```bash
./start-dev.sh
```

Expected:

- `admin` starts at `http://127.0.0.1:9000`
- `chat` starts at `http://127.0.0.1:9002`
- `service` starts at `http://127.0.0.1:9527`

- [ ] **Step 2: Desktop checks**

Open `http://127.0.0.1:9002` and verify:

- existing left conversation sidebar still works
- chat area remains readable at 1440px and 1920px widths
- right workspace appears after selecting/creating a conversation
- files tab loads artifact count and file tree
- clicking markdown/code/html file opens preview tab
- terminal tab shows tool execution records during an agent run
- info tab shows container status when `PI_DOCKER_ENABLED=1`
- no text overlaps inside tab bar or footer

- [ ] **Step 3: Mobile checks**

At mobile viewport width:

- no right panel is rendered
- current chat layout remains single column
- “查看对话中的所有文件” still opens drawer
- footer input remains reachable

- [ ] **Step 4: Dark theme checks**

Switch dark theme and verify:

- right workspace uses current dark palette
- borders remain visible
- iframe preview is visually separated from panel chrome
- terminal rows are readable

- [ ] **Step 5: Final verification**

Run:

```bash
cd chat && pnpm test
cd chat && pnpm build-check
cd service && pnpm test -- piRuntimeManager.spec.ts chat.service.spec.ts --runInBand
cd service && pnpm build:test
```

Expected: all commands pass.

- [ ] **Step 6: Commit visual polish if needed**

If visual-only CSS adjustments are needed:

```bash
git add chat/src/views/chat
git commit -m "style: polish chat runtime workspace"
```

---

## Rollback Plan

If the right workspace disrupts chat usability:

1. Revert only Task 8 integration commit.
2. Keep extracted `ArtifactWorkspace.vue`; `ArtifactsDrawer.vue` should still work.
3. The backend runtime status API can remain because it is additive.

---

## Acceptance Criteria

- Desktop chat page shows a stable two-pane workspace for active conversations.
- Mobile behavior is unchanged.
- Existing chat streaming behavior is unchanged.
- Existing artifact drawer still works on mobile.
- Right files panel uses current artifact APIs.
- Preview opens from file selection.
- Terminal tab shows current conversation tool execution logs.
- Info tab shows current conversation runtime/container state.
- `cd chat && pnpm build-check` passes.
- `cd service && pnpm build:test` passes.

