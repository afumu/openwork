<script setup lang="ts">
import {
  fetchRuntimeStatusAPI,
  fetchRuntimeWorkspaceListAPI,
  fetchRuntimeWorkspaceReadAPI,
} from '@/api/runtime'
import { copyText } from '@/utils/format'
import { shouldRefreshSelectedArtifact } from '@/utils/artifactPreview'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Pane, Splitpanes } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import {
  buildWorkspaceTreeFromFiles,
  flattenArtifactManifestFiles,
  sortWorkspaceTree,
  unwrapArtifactPayload,
} from './artifactWorkspace'
import { resolveIdeTabTitle } from './ideWorkspace'
import {
  buildRuntimeInfoSummary,
  resolveWorkspaceOpenTarget,
  resolveWorkspaceToolbarCopyText,
} from './runtimeWorkspaceActions'
import RuntimeCodeEditor from './RuntimeCodeEditor.vue'
import RuntimeFileExplorer from './RuntimeFileExplorer.vue'
import RuntimePreviewPane from './RuntimePreviewPane.vue'
import RuntimeTerminalPane from './RuntimeTerminalPane.vue'
import type {
  ArtifactManifest,
  ArtifactReadResult,
  ArtifactWorkspaceTreeItem,
  RuntimeStatusPayload,
} from './types'

type MainWorkspaceTab = 'preview' | 'code'

const props = defineProps<{
  artifactCount: number
  chats: Chat.Chat[]
  groupId: number
  initialPath?: string
  isStreaming: boolean
}>()

const activeMainTab = ref<MainWorkspaceTab>('code')
const manifest = ref<ArtifactManifest | null>(null)
const loadingArtifacts = ref(false)
const readingFile = ref(false)
const loadError = ref('')
const selectedPath = ref('')
const selectedFile = ref<ArtifactReadResult | null>(null)
const runtimeStatus = ref<RuntimeStatusPayload | null>(null)
const runtimeLoading = ref(false)
const pollTimer = ref<number | null>(null)
const showRuntimeInfo = ref(false)
const toolbarMessage = ref('')
const toolbarMessageTimer = ref<number | null>(null)

const workspaceFiles = computed(() => flattenArtifactManifestFiles(manifest.value))

const workspaceTree = computed<ArtifactWorkspaceTreeItem[]>(() => {
  const directTree = manifest.value?.workspaceTree
  if (directTree?.length) return sortWorkspaceTree(directTree)
  return buildWorkspaceTreeFromFiles(workspaceFiles.value)
})

const normalizedSelectedPath = computed(() => normalizeWorkspacePath(selectedPath.value))

const selectedFileRecord = computed(
  () => workspaceFiles.value.find(file => file.path === normalizedSelectedPath.value) || null
)

const selectedTitle = computed(() => resolveIdeTabTitle(selectedFile.value))

const runtimeStatusText = computed(() => {
  if (runtimeStatus.value?.status) return runtimeStatus.value.status
  if (runtimeStatus.value?.running) return '运行中'
  return props.isStreaming ? '执行中' : '空闲'
})

const runtimeModeText = computed(() => {
  if (!runtimeStatus.value?.mode) return 'runtime'
  if (runtimeStatus.value.mode === 'opensandbox') return 'OpenSandbox'
  return runtimeStatus.value.mode === 'docker' ? 'Docker' : 'Direct'
})

const fileCountText = computed(() => workspaceFiles.value.length || props.artifactCount || 0)

const runtimeInfoSummary = computed(() =>
  buildRuntimeInfoSummary({
    fileCount: Number(fileCountText.value),
    runtimeStatus: runtimeStatus.value,
    selectedPath: selectedPath.value,
    workspaceDir: manifest.value?.workspaceDir,
  })
)

function normalizeWorkspacePath(path?: string) {
  const trimmedPath = String(path || '')
    .trim()
    .replace(/^\.?\//, '')
  if (manifest.value?.workspaceRootMode === 'data') {
    return trimmedPath.replace(/^data\/+/, '')
  }
  return trimmedPath
}

function clearSelection() {
  selectedPath.value = ''
  selectedFile.value = null
}

function clearPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

function clearToolbarMessageTimer() {
  if (toolbarMessageTimer.value) {
    window.clearTimeout(toolbarMessageTimer.value)
    toolbarMessageTimer.value = null
  }
}

function showToolbarMessage(message: string) {
  clearToolbarMessageTimer()
  toolbarMessage.value = message
  toolbarMessageTimer.value = window.setTimeout(() => {
    toolbarMessage.value = ''
    toolbarMessageTimer.value = null
  }, 1800)
}

function startPolling() {
  clearPolling()
  if (!props.groupId || !props.isStreaming) return

  pollTimer.value = window.setInterval(() => {
    void loadArtifacts(false)
    void loadRuntimeStatus(false)
  }, 3000)
}

async function loadArtifacts(showLoading = true) {
  if (!props.groupId) {
    manifest.value = null
    clearSelection()
    return
  }

  if (showLoading) loadingArtifacts.value = true
  loadError.value = ''

  try {
    const res: any = await fetchRuntimeWorkspaceListAPI({ groupId: props.groupId })
    const nextManifest = unwrapArtifactPayload<ArtifactManifest>(res)
    if (!nextManifest) throw new Error('文件列表返回格式不正确')

    manifest.value = nextManifest
    const nextFiles = flattenArtifactManifestFiles(nextManifest)
    const selectedStillExists = nextFiles.find(
      file => file.path === normalizeWorkspacePath(selectedPath.value)
    )

    if (!selectedStillExists) {
      clearSelection()
    } else if (
      shouldRefreshSelectedArtifact({
        previewVisible: Boolean(selectedFile.value),
        readResult: selectedFile.value,
        selectedFile: selectedStillExists,
        selectedPath: selectedPath.value,
      })
    ) {
      void loadFile(selectedStillExists.path, selectedStillExists.runId, {
        preserveCurrentContent: true,
      })
    }
  } catch (error: any) {
    manifest.value = null
    clearSelection()
    loadError.value = error?.message || '文件列表加载失败'
  } finally {
    loadingArtifacts.value = false
  }
}

async function loadRuntimeStatus(showLoading = true) {
  if (!props.groupId) {
    runtimeStatus.value = null
    return
  }

  if (showLoading) runtimeLoading.value = true

  try {
    const res: any = await fetchRuntimeStatusAPI<{ data?: RuntimeStatusPayload }>({
      groupId: props.groupId,
    })
    runtimeStatus.value = unwrapRuntimeStatus(res)
  } catch (_error) {
    runtimeStatus.value = null
  } finally {
    runtimeLoading.value = false
  }
}

async function loadFile(
  path: string,
  _runId?: string | null,
  options: { preserveCurrentContent?: boolean } = {}
) {
  if (!props.groupId || !path) return

  const normalizedPath = normalizeWorkspacePath(path)
  const keepCurrentContent =
    options.preserveCurrentContent &&
    normalizedSelectedPath.value === normalizedPath &&
    selectedFile.value !== null

  selectedPath.value = normalizedPath
  activeMainTab.value = 'code'
  if (!keepCurrentContent) readingFile.value = true
  loadError.value = ''

  try {
    const res: any = await fetchRuntimeWorkspaceReadAPI({
      groupId: props.groupId,
      path,
    })
    const nextReadResult = unwrapArtifactPayload<ArtifactReadResult>(res)
    if (!nextReadResult) throw new Error('文件内容返回格式不正确')
    selectedFile.value = nextReadResult
  } catch (error: any) {
    if (!keepCurrentContent) selectedFile.value = null
    loadError.value = error?.message || '文件读取失败'
  } finally {
    if (!keepCurrentContent) readingFile.value = false
  }
}

function unwrapRuntimeStatus(payload: any): RuntimeStatusPayload | null {
  if (!payload || typeof payload !== 'object') return null
  if ('groupId' in payload || 'status' in payload || 'mode' in payload) return payload
  if ('data' in payload) return unwrapRuntimeStatus(payload.data)
  return null
}

function handleOpenSelectedPreview() {
  if (!selectedFile.value) return
  activeMainTab.value = 'preview'
}

async function refreshWorkspace() {
  await Promise.all([loadArtifacts(true), loadRuntimeStatus(true)])
  showToolbarMessage('工作区已刷新')
}

function toggleRuntimeInfo() {
  showRuntimeInfo.value = !showRuntimeInfo.value
}

function copySelectedFile() {
  const text = resolveWorkspaceToolbarCopyText(selectedFile.value)
  if (!text) {
    showToolbarMessage('请先选择一个文件')
    return
  }

  copyText({ text, origin: true })
  showToolbarMessage('已复制当前文件内容')
}

function openSelectedFile() {
  const target = resolveWorkspaceOpenTarget(selectedFile.value)
  if (!target) {
    showToolbarMessage('请先选择一个文件')
    return
  }

  if (target.kind === 'url') {
    window.open(target.url, '_blank', 'noopener')
    return
  }

  const url = URL.createObjectURL(new Blob([target.content], { type: target.mimeType }))
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function showDeployPending() {
  showToolbarMessage('部署能力尚未接入')
}

watch(
  () => props.groupId,
  groupId => {
    if (groupId) {
      void loadArtifacts(true)
      void loadRuntimeStatus(true)
    } else {
      manifest.value = null
      runtimeStatus.value = null
      clearSelection()
    }
    startPolling()
  },
  { immediate: true }
)

watch(
  () => [props.initialPath, workspaceFiles.value.length] as const,
  ([initialPath]) => {
    if (!initialPath) return
    const normalizedInitialPath = normalizeWorkspacePath(initialPath)
    const matchedFile = workspaceFiles.value.find(file => file.path === normalizedInitialPath)
    if (!matchedFile) return
    if (normalizedSelectedPath.value === normalizedInitialPath && selectedFile.value) return
    void loadFile(matchedFile.path, matchedFile.runId)
  },
  { immediate: true }
)

watch(
  () => props.isStreaming,
  () => {
    startPolling()
    void loadRuntimeStatus(false)
  }
)

onBeforeUnmount(() => {
  clearPolling()
  clearToolbarMessageTimer()
})
</script>

<template>
  <aside class="runtime-ide-workspace flex h-full min-h-0 border-l border-zinc-200 bg-white">
    <Splitpanes class="runtime-ide-split h-full w-full">
      <Pane min-size="17" size="24" max-size="34">
        <RuntimeFileExplorer
          class="h-full"
          :loading="loadingArtifacts"
          :selected-path="selectedPath"
          :tree="workspaceTree"
          @refresh="loadArtifacts(true)"
          @select-file="payload => loadFile(payload.path, payload.runId)"
        />
      </Pane>

      <Pane min-size="52" size="76">
        <section class="flex h-full min-h-0 flex-col bg-white text-zinc-900">
          <header
            class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-3"
          >
            <div class="flex min-w-0 items-center gap-2">
              <button
                class="main-tab"
                :class="{ 'main-tab-active': activeMainTab === 'preview' }"
                type="button"
                @click="handleOpenSelectedPreview"
              >
                预览
              </button>
              <button
                class="main-tab"
                :class="{ 'main-tab-active': activeMainTab === 'code' }"
                type="button"
                @click="activeMainTab = 'code'"
              >
                &lt;&gt; 代码
              </button>
              <button
                class="new-tab hidden 2xl:inline-flex"
                type="button"
                @click="openSelectedFile"
              >
                ＋ 新标签页
              </button>
              <span class="hidden min-w-0 truncate pl-1 text-xs text-zinc-500 xl:block">
                {{ selectedFileRecord?.path || selectedTitle }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <span class="runtime-pill" :class="{ 'runtime-pill-active': isStreaming }">
                {{ runtimeLoading ? '检查中' : runtimeStatusText }}
              </span>
              <span class="hidden text-xs text-zinc-500 2xl:inline">
                {{ runtimeModeText }} · 文件 {{ fileCountText }}
              </span>
              <span v-if="toolbarMessage" class="hidden text-xs text-zinc-500 xl:inline">
                {{ toolbarMessage }}
              </span>
              <button class="toolbar-icon" type="button" title="刷新工作区" @click="refreshWorkspace">
                ⟳
              </button>
              <button
                class="toolbar-icon"
                type="button"
                title="工作区信息"
                :class="{ 'toolbar-icon-active': showRuntimeInfo }"
                @click="toggleRuntimeInfo"
              >
                ☷
              </button>
              <button
                class="toolbar-icon"
                type="button"
                title="复制当前文件内容"
                @click="copySelectedFile"
              >
                ▣
              </button>
              <button
                class="toolbar-icon"
                type="button"
                title="在新标签页打开当前文件"
                @click="openSelectedFile"
              >
                ↗
              </button>
              <button class="deploy-button" type="button" @click="showDeployPending">部署</button>
            </div>
          </header>

          <div
            v-if="showRuntimeInfo"
            class="border-b border-zinc-200 bg-white px-4 py-3 text-xs leading-5 text-zinc-600"
          >
            <pre class="whitespace-pre-wrap font-sans">{{ runtimeInfoSummary }}</pre>
          </div>

          <div
            v-if="loadError"
            class="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"
          >
            {{ loadError }}
          </div>

          <Splitpanes horizontal class="runtime-ide-main min-h-0 flex-1">
            <Pane min-size="45" size="72">
              <div class="relative h-full min-h-0 overflow-hidden">
                <div
                  v-if="readingFile"
                  class="absolute right-4 top-4 z-10 rounded-md border border-zinc-200 bg-white/90 px-3 py-1 text-xs text-zinc-600 shadow-lg"
                >
                  正在读取文件...
                </div>

                <RuntimePreviewPane
                  v-show="activeMainTab === 'preview'"
                  class="h-full rounded-none border-0"
                  :file="selectedFile"
                />
                <RuntimeCodeEditor
                  v-show="activeMainTab === 'code'"
                  class="h-full"
                  :file="selectedFile"
                  readonly
                />
              </div>
            </Pane>

            <Pane min-size="18" size="28" max-size="44">
              <RuntimeTerminalPane
                class="h-full"
                :chats="chats"
                :group-id="groupId"
                :is-streaming="isStreaming"
              />
            </Pane>
          </Splitpanes>
        </section>
      </Pane>
    </Splitpanes>
  </aside>
</template>

<style scoped>
.runtime-ide-workspace {
  color-scheme: light;
}

.main-tab,
.new-tab {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 10px;
  padding: 0 16px;
  color: #52525b;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.main-tab:hover,
.new-tab:hover,
.toolbar-icon:hover {
  background: #f4f4f5;
  color: #18181b;
}

.toolbar-icon-active {
  background: #e4e4e7;
  color: #18181b;
}

.main-tab-active {
  background: #e4e4e7;
  color: #18181b;
}

.new-tab {
  color: #3f3f46;
}

.runtime-pill {
  display: inline-flex;
  height: 24px;
  align-items: center;
  border-radius: 999px;
  background: #f4f4f5;
  padding: 0 9px;
  color: #52525b;
  font-size: 12px;
  white-space: nowrap;
}

.runtime-pill-active {
  background: rgba(34, 197, 94, 0.14);
  color: #15803d;
}

.toolbar-icon {
  display: inline-flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid #d4d4d8;
  color: #3f3f46;
  font-size: 16px;
}

.toolbar-icon:first-of-type {
  border-radius: 10px 0 0 10px;
}

.toolbar-icon + .toolbar-icon {
  margin-left: -3px;
}

.toolbar-icon:nth-of-type(4) {
  border-radius: 0 10px 10px 0;
}

.deploy-button {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #f4f4f5;
  padding: 0 15px;
  color: #18181b;
  font-size: 14px;
  font-weight: 700;
}

.runtime-ide-split :deep(.splitpanes__pane),
.runtime-ide-main :deep(.splitpanes__pane) {
  background: transparent;
}

.runtime-ide-split :deep(.splitpanes__splitter) {
  min-width: 1px;
  border-left: 1px solid #e4e4e7;
  background: #fafafa;
}

.runtime-ide-main :deep(.splitpanes__splitter) {
  min-height: 1px;
  border-top: 1px solid #e4e4e7;
  background: #fafafa;
}

.runtime-ide-split :deep(.splitpanes__splitter:hover),
.runtime-ide-main :deep(.splitpanes__splitter:hover) {
  background: #3b82f6;
}
</style>
