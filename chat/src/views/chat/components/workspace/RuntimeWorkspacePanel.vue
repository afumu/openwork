<script setup lang="ts">
import { fetchArtifactListAPI, fetchArtifactReadAPI } from '@/api/artifacts'
import { fetchRuntimeStatusAPI } from '@/api/runtime'
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
  return runtimeStatus.value.mode === 'docker' ? 'Docker' : 'Direct'
})

const fileCountText = computed(() => workspaceFiles.value.length || props.artifactCount || 0)

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
    const res: any = await fetchArtifactListAPI({ groupId: props.groupId })
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
  runId?: string | null,
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
    const res: any = await fetchArtifactReadAPI({
      groupId: props.groupId,
      path,
      runId: runId || undefined,
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
})
</script>

<template>
  <aside class="runtime-ide-workspace flex h-full min-h-0 border-l border-[#2b2b2b] bg-[#111]">
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
        <section class="flex h-full min-h-0 flex-col bg-[#111] text-zinc-100">
          <header
            class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#272727] bg-[#111] px-3"
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
              <button class="new-tab hidden 2xl:inline-flex" type="button">＋ 新标签页</button>
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
              <button class="toolbar-icon" type="button" title="主题">◐</button>
              <button class="toolbar-icon" type="button" title="设置">☷</button>
              <button class="toolbar-icon" type="button" title="复制">▣</button>
              <button class="toolbar-icon" type="button" title="打开">↗</button>
              <button class="deploy-button" type="button">部署</button>
            </div>
          </header>

          <div
            v-if="loadError"
            class="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200"
          >
            {{ loadError }}
          </div>

          <Splitpanes horizontal class="runtime-ide-main min-h-0 flex-1">
            <Pane min-size="45" size="72">
              <div class="relative h-full min-h-0 overflow-hidden">
                <div
                  v-if="readingFile"
                  class="absolute right-4 top-4 z-10 rounded-md border border-white/10 bg-black/70 px-3 py-1 text-xs text-zinc-300 shadow-lg"
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
              <RuntimeTerminalPane class="h-full" :chats="chats" :is-streaming="isStreaming" />
            </Pane>
          </Splitpanes>
        </section>
      </Pane>
    </Splitpanes>
  </aside>
</template>

<style scoped>
.runtime-ide-workspace {
  color-scheme: dark;
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
  color: #d4d4d8;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.main-tab:hover,
.new-tab:hover,
.toolbar-icon:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.main-tab-active {
  background: #3e3b37;
  color: #fafafa;
}

.new-tab {
  color: #e4e4e7;
}

.runtime-pill {
  display: inline-flex;
  height: 24px;
  align-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  padding: 0 9px;
  color: #a1a1aa;
  font-size: 12px;
  white-space: nowrap;
}

.runtime-pill-active {
  background: rgba(34, 197, 94, 0.14);
  color: #86efac;
}

.toolbar-icon {
  display: inline-flex;
  height: 32px;
  width: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e4e4e7;
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
  border-left: 1px solid #242424;
  background: #111;
}

.runtime-ide-main :deep(.splitpanes__splitter) {
  min-height: 1px;
  border-top: 1px solid #242424;
  background: #111;
}

.runtime-ide-split :deep(.splitpanes__splitter:hover),
.runtime-ide-main :deep(.splitpanes__splitter:hover) {
  background: #3b82f6;
}
</style>
