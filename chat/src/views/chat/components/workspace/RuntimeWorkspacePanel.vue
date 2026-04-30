<script setup lang="ts">
import {
  createRuntimeWorkspaceEntryAPI,
  deleteRuntimeWorkspaceEntryAPI,
  fetchRuntimeStatusAPI,
  fetchRuntimeWorkspaceListAPI,
  fetchRuntimeWorkspaceReadAPI,
  renameRuntimeWorkspaceEntryAPI,
  writeRuntimeWorkspaceFileAPI,
  type RuntimeWorkspaceEntry,
} from '@/api/runtime'
import { copyText } from '@/utils/format'
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
import { useRuntimeWorkspaceTabs } from './useRuntimeWorkspaceTabs'
import type {
  ArtifactManifest,
  ArtifactReadResult,
  ArtifactWorkspaceFileItem,
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
const runtimeStatus = ref<RuntimeStatusPayload | null>(null)
const runtimeLoading = ref(false)
const pollTimer = ref<number | null>(null)
const showRuntimeInfo = ref(false)
const toolbarMessage = ref('')
const toolbarMessageTimer = ref<number | null>(null)
const previewManualReloadKey = ref(0)

const {
  activePath,
  activeTab,
  closeDeletedCleanTabs,
  closeTab,
  keepLocalChanges,
  markExternalUpdate,
  markTabSaved,
  resetTabs,
  setActivePath,
  tabs,
  updateActiveContent,
  upsertTab,
} = useRuntimeWorkspaceTabs()

const workspaceFiles = computed(() => flattenArtifactManifestFiles(manifest.value))

const workspaceTree = computed<ArtifactWorkspaceTreeItem[]>(() => {
  const directTree = manifest.value?.workspaceTree
  if (directTree?.length) return sortWorkspaceTree(directTree)
  return buildWorkspaceTreeFromFiles(workspaceFiles.value)
})

const selectedPath = computed(() => activePath.value)
const normalizedSelectedPath = computed(() => normalizeWorkspacePath(activePath.value))

const selectedFileRecord = computed(
  () => workspaceFiles.value.find(file => file.path === normalizedSelectedPath.value) || null
)

const selectedFile = computed<ArtifactReadResult | null>(() => {
  const tab = activeTab.value
  if (!tab) return null
  return {
    ...tab.file,
    content: tab.content,
    path: tab.path,
    size: tab.content.length,
  }
})

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

const appPreview = computed(() => runtimeStatus.value?.preview || null)
const fileCountText = computed(() => workspaceFiles.value.length || props.artifactCount || 0)
const activeEditorContent = computed(() => activeTab.value?.content || '')
const activeDirty = computed(() => Boolean(activeTab.value?.dirty))
const activeSaving = computed(() => Boolean(activeTab.value?.saving))

const runtimeInfoSummary = computed(() =>
  buildRuntimeInfoSummary({
    fileCount: Number(fileCountText.value),
    runtimeStatus: runtimeStatus.value,
    selectedPath: activePath.value,
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
  setActivePath('')
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
    resetTabs()
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
    const pathSet = new Set(nextFiles.map(file => file.path))
    closeDeletedCleanTabs(pathSet)

    nextFiles.forEach(file => {
      const updateState = markExternalUpdate(file)
      if (updateState === 'reload') void reloadOpenTab(file.path)
    })

    if (activePath.value && !pathSet.has(activePath.value) && !activeTab.value?.dirty) clearSelection()
  } catch (error: any) {
    manifest.value = null
    resetTabs()
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

async function loadFile(path: string, _runId?: string | null) {
  if (!props.groupId || !path) return

  const normalizedPath = normalizeWorkspacePath(path)
  const existingTab = tabs.value.find(tab => tab.path === normalizedPath)
  if (existingTab) {
    setActivePath(normalizedPath)
    activeMainTab.value = 'code'
    return
  }

  activeMainTab.value = 'code'
  readingFile.value = true
  loadError.value = ''

  try {
    const file = await readWorkspaceFile(normalizedPath)
    upsertTab(file)
  } catch (error: any) {
    loadError.value = error?.message || '文件读取失败'
  } finally {
    readingFile.value = false
  }
}

async function readWorkspaceFile(path: string) {
  const res: any = await fetchRuntimeWorkspaceReadAPI({
    groupId: props.groupId,
    path,
  })
  const nextReadResult = unwrapArtifactPayload<ArtifactReadResult>(res)
  if (!nextReadResult) throw new Error('文件内容返回格式不正确')
  return {
    ...nextReadResult,
    path: normalizeWorkspacePath(nextReadResult.path || path),
  }
}

async function reloadOpenTab(path: string) {
  if (!props.groupId || !path) return
  try {
    const file = await readWorkspaceFile(path)
    upsertTab(file)
  } catch (error: any) {
    loadError.value = error?.message || '文件重新加载失败'
  }
}

function unwrapRuntimeStatus(payload: any): RuntimeStatusPayload | null {
  if (!payload || typeof payload !== 'object') return null
  if ('groupId' in payload || 'status' in payload || 'mode' in payload) return payload
  if ('data' in payload) return unwrapRuntimeStatus(payload.data)
  return null
}

function unwrapWorkspaceEntry(payload: any): RuntimeWorkspaceEntry | null {
  if (!payload || typeof payload !== 'object') return null
  if ('path' in payload && 'updatedAt' in payload) return payload as RuntimeWorkspaceEntry
  if ('entry' in payload) return unwrapWorkspaceEntry(payload.entry)
  if ('data' in payload) return unwrapWorkspaceEntry(payload.data)
  return null
}

function handleOpenSelectedPreview() {
  if (!selectedFile.value && !appPreview.value?.url) return
  if (appPreview.value?.url) previewManualReloadKey.value += 1
  activeMainTab.value = 'preview'
}

async function refreshWorkspace() {
  await Promise.all([loadArtifacts(true), loadRuntimeStatus(true)])
  previewManualReloadKey.value += 1
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
  if (activeMainTab.value === 'preview' && appPreview.value?.url) {
    window.open(appPreview.value.url, '_blank', 'noopener')
    return
  }

  const target = resolveWorkspaceOpenTarget(selectedFile.value)
  if (!target) {
    showToolbarMessage(appPreview.value?.url ? '请先切换到预览' : '请先选择一个文件')
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

async function saveActiveFile() {
  const tab = activeTab.value
  if (!props.groupId || !tab || tab.saving) return
  tab.saving = true
  loadError.value = ''

  try {
    const res: any = await writeRuntimeWorkspaceFileAPI({
      baseUpdatedAt: tab.baseUpdatedAt,
      content: tab.content,
      groupId: props.groupId,
      path: tab.path,
    })
    const entry = unwrapWorkspaceEntry(res)
    markTabSaved(tab.path, {
      updatedAt: entry?.updatedAt || new Date().toISOString(),
      type: entry?.type || tab.file.type,
    } as ArtifactWorkspaceFileItem)
    await loadArtifacts(false)
    previewManualReloadKey.value += 1
    showToolbarMessage('文件已保存')
  } catch (error: any) {
    loadError.value = error?.message || '文件保存失败'
  } finally {
    tab.saving = false
  }
}

function closeEditorTab(path: string) {
  return closeTab(path, tab => window.confirm(`文件 ${tab.path} 有未保存修改，确定关闭？`))
}

async function createFile() {
  if (!props.groupId) return
  const path = window.prompt('请输入新文件路径')?.trim()
  if (!path) return

  try {
    const res: any = await createRuntimeWorkspaceEntryAPI({
      content: '',
      groupId: props.groupId,
      kind: 'file',
      path: normalizeWorkspacePath(path),
    })
    const entry = unwrapWorkspaceEntry(res)
    await loadArtifacts(true)
    await loadFile(entry?.path || path)
    showToolbarMessage('文件已创建')
  } catch (error: any) {
    loadError.value = error?.message || '文件创建失败'
  }
}

async function renameSelectedFile() {
  if (!props.groupId || !activePath.value) {
    showToolbarMessage('请先选择一个文件')
    return
  }
  const toPath = window.prompt('请输入新的文件路径', activePath.value)?.trim()
  if (!toPath || toPath === activePath.value) return

  try {
    const res: any = await renameRuntimeWorkspaceEntryAPI({
      fromPath: activePath.value,
      groupId: props.groupId,
      toPath: normalizeWorkspacePath(toPath),
    })
    const entry = unwrapWorkspaceEntry(res)
    if (!closeEditorTab(activePath.value)) return
    await loadArtifacts(true)
    await loadFile(entry?.path || toPath)
    showToolbarMessage('文件已重命名')
  } catch (error: any) {
    loadError.value = error?.message || '文件重命名失败'
  }
}

async function deleteSelectedFile() {
  if (!props.groupId || !activePath.value) {
    showToolbarMessage('请先选择一个文件')
    return
  }
  if (!window.confirm(`确定删除 ${activePath.value}？`)) return

  try {
    await deleteRuntimeWorkspaceEntryAPI({
      groupId: props.groupId,
      path: activePath.value,
    })
    closeTab(activePath.value, () => true)
    await loadArtifacts(true)
    previewManualReloadKey.value += 1
    showToolbarMessage('文件已删除')
  } catch (error: any) {
    loadError.value = error?.message || '文件删除失败'
  }
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
      resetTabs()
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
          @create-file="createFile"
          @delete-selected="deleteSelectedFile"
          @refresh="loadArtifacts(true)"
          @rename-selected="renameSelectedFile"
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
              <button
                class="save-button"
                type="button"
                :disabled="!activeDirty || activeSaving"
                title="保存当前文件 (Cmd/Ctrl+S)"
                @click="saveActiveFile"
              >
                {{ activeSaving ? '保存中' : activeDirty ? '保存' : '已保存' }}
              </button>
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
                  :app-preview-port="appPreview?.port"
                  :app-preview-reload-key="previewManualReloadKey"
                  :app-preview-running="appPreview?.running"
                  :app-preview-url="appPreview?.url"
                  :file="selectedFile"
                />
                <RuntimeCodeEditor
                  v-show="activeMainTab === 'code'"
                  class="h-full"
                  :active-path="activePath"
                  :model-value="activeEditorContent"
                  :saving="activeSaving"
                  :tabs="tabs"
                  @close-tab="closeEditorTab"
                  @keep-conflict="keepLocalChanges"
                  @reload-conflict="reloadOpenTab"
                  @save="saveActiveFile"
                  @select-tab="setActivePath"
                  @update:model-value="updateActiveContent"
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

.main-tab {
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

.save-button {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid #2563eb;
  padding: 0 12px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.save-button:disabled {
  border-color: #d4d4d8;
  color: #a1a1aa;
}

.save-button:not(:disabled):hover {
  background: #eff6ff;
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
