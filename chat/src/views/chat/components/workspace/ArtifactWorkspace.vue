<script setup lang="ts">
import { fetchArtifactListAPI, fetchArtifactReadAPI } from '@/api/artifacts'
import { shouldRefreshSelectedArtifact } from '@/utils/artifactPreview'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  buildWorkspaceTreeFromFiles,
  flattenArtifactManifestFiles,
  sortWorkspaceTree,
  unwrapArtifactPayload,
} from './artifactWorkspace'
import RuntimePreviewPane from './RuntimePreviewPane.vue'
import type {
  ArtifactManifest,
  ArtifactReadResult,
  ArtifactWorkspaceFileItem,
  ArtifactWorkspaceTreeItem,
} from './types'

interface ArtifactTreeRow {
  depth: number
  node: ArtifactWorkspaceTreeItem
}

type FileFilterKey = 'all' | 'document' | 'image' | 'code' | 'link'

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

const manifest = ref<ArtifactManifest | null>(null)
const loading = ref(false)
const reading = ref(false)
const loadError = ref('')
const selectedPath = ref('')
const readResult = ref<ArtifactReadResult | null>(null)
const activeFilter = ref<FileFilterKey>('all')
const expandedDirectories = ref<string[]>([])
const drawerPreviewVisible = ref(false)
const pollTimer = ref<number | null>(null)

const fileFilters: Array<{ key: FileFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'document', label: '文档' },
  { key: 'image', label: '图片' },
  { key: 'code', label: '代码' },
  { key: 'link', label: '链接' },
]

const workspaceFiles = computed(() => flattenArtifactManifestFiles(manifest.value))

const workspaceTree = computed<ArtifactWorkspaceTreeItem[]>(() => {
  const directTree = manifest.value?.workspaceTree
  if (directTree?.length) return sortWorkspaceTree(directTree)
  return buildWorkspaceTreeFromFiles(workspaceFiles.value)
})

const selectedFile = computed(
  () => workspaceFiles.value.find(file => file.path === normalizedSelectedPath.value) || null
)

const normalizedSelectedPath = computed(() => normalizeWorkspacePath(selectedPath.value))

const filterCountMap = computed<Record<FileFilterKey, number>>(() => {
  const countMap: Record<FileFilterKey, number> = {
    all: workspaceFiles.value.length,
    document: 0,
    image: 0,
    code: 0,
    link: 0,
  }

  workspaceFiles.value.forEach(file => {
    countMap[resolveFilterKey(file)] += 1
  })

  return countMap
})

const filteredWorkspaceTree = computed(() =>
  sortWorkspaceTree(filterWorkspaceTree(workspaceTree.value, activeFilter.value))
)

const treeRows = computed(() => flattenWorkspaceTreeRows(filteredWorkspaceTree.value))

const workspaceLabel = computed(() => {
  if (!manifest.value?.workspaceDir) return '当前任务工作区'
  const rootLabel =
    manifest.value.workspaceRootMode === 'data' ? '根目录：data' : '根目录：对话工作区'
  return `${rootLabel} · ${manifest.value.workspaceDir}`
})

function normalizeWorkspacePath(path?: string) {
  const trimmedPath = String(path || '')
    .trim()
    .replace(/^\.?\//, '')
  if (manifest.value?.workspaceRootMode === 'data') {
    return trimmedPath.replace(/^data\/+/, '')
  }
  return trimmedPath
}

function getFileExtension(path: string) {
  const normalizedPath = path.split('?')[0] || path
  const fileName = normalizedPath.split('/').pop() || normalizedPath
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}

function resolveFilterKey(file: ArtifactWorkspaceFileItem): FileFilterKey {
  const ext = getFileExtension(file.path)
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
  const codeExtensions = [
    'html',
    'htm',
    'js',
    'ts',
    'jsx',
    'tsx',
    'css',
    'scss',
    'less',
    'json',
    'vue',
    'py',
    'java',
    'go',
    'rs',
    'sh',
    'sql',
    'yaml',
    'yml',
    'xml',
  ]
  const linkExtensions = ['url', 'webloc']

  if (file.type.startsWith('image/') || file.type === 'image' || imageExtensions.includes(ext)) {
    return 'image'
  }
  if (file.type.includes('html') || codeExtensions.includes(ext)) return 'code'
  if (linkExtensions.includes(ext)) return 'link'
  if ((file.preview || '').startsWith('http://') || (file.preview || '').startsWith('https://')) {
    return 'link'
  }
  return 'document'
}

function resolveFileMeta(file: ArtifactWorkspaceFileItem) {
  const filterKey = resolveFilterKey(file)

  if (filterKey === 'image')
    return { badge: '图', badgeClass: 'workspace-badge-image', label: '图片' }
  if (filterKey === 'code')
    return { badge: '</>', badgeClass: 'workspace-badge-code', label: '代码' }
  if (filterKey === 'link')
    return { badge: '链', badgeClass: 'workspace-badge-link', label: '链接' }
  return { badge: '文', badgeClass: 'workspace-badge-doc', label: '文档' }
}

function filterWorkspaceTree(
  nodes: ArtifactWorkspaceTreeItem[],
  filterKey: FileFilterKey
): ArtifactWorkspaceTreeItem[] {
  if (filterKey === 'all') return nodes

  return nodes
    .map(node => {
      if (node.nodeType === 'file') {
        return resolveFilterKey(node) === filterKey ? node : null
      }

      const children = filterWorkspaceTree(node.children, filterKey)
      if (!children.length) return null
      return { ...node, children }
    })
    .filter(Boolean) as ArtifactWorkspaceTreeItem[]
}

function collectDirectoryPaths(nodes: ArtifactWorkspaceTreeItem[], bucket = new Set<string>()) {
  nodes.forEach(node => {
    if (node.nodeType !== 'directory') return
    bucket.add(node.path)
    collectDirectoryPaths(node.children, bucket)
  })
  return bucket
}

function collectTopLevelDirectories(nodes: ArtifactWorkspaceTreeItem[]) {
  return nodes.filter(node => node.nodeType === 'directory').map(node => node.path)
}

function collectAncestorDirectories(path: string) {
  const segments = path.split('/').filter(Boolean)
  const ancestors: string[] = []

  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join('/'))
  }

  return ancestors
}

function syncExpandedDirectories(nextTree: ArtifactWorkspaceTreeItem[], preferredPath = '') {
  const validPaths = collectDirectoryPaths(nextTree)
  const nextExpanded = new Set(expandedDirectories.value.filter(path => validPaths.has(path)))

  collectTopLevelDirectories(nextTree).forEach(path => {
    if (validPaths.has(path)) nextExpanded.add(path)
  })

  collectAncestorDirectories(preferredPath).forEach(path => {
    if (validPaths.has(path)) nextExpanded.add(path)
  })

  expandedDirectories.value = Array.from(nextExpanded)
}

function isDirectoryExpanded(path: string) {
  return expandedDirectories.value.includes(path)
}

function toggleDirectory(path: string) {
  if (isDirectoryExpanded(path)) {
    expandedDirectories.value = expandedDirectories.value.filter(item => item !== path)
    return
  }

  expandedDirectories.value = [...expandedDirectories.value, path]
}

function flattenWorkspaceTreeRows(
  nodes: ArtifactWorkspaceTreeItem[],
  depth = 0
): ArtifactTreeRow[] {
  return nodes.flatMap(node => {
    const currentRow: ArtifactTreeRow = { depth, node }

    if (node.nodeType !== 'directory' || !isDirectoryExpanded(node.path)) {
      return [currentRow]
    }

    return [currentRow, ...flattenWorkspaceTreeRows(node.children, depth + 1)]
  })
}

function formatTimeLabel(value?: string) {
  if (!value) return '--'

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch (_error) {
    return value
  }
}

function clearSelection() {
  selectedPath.value = ''
  readResult.value = null
  drawerPreviewVisible.value = false
  emit('preview-ready', null)
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
  }, 3000)
}

async function loadArtifacts(showLoading = true) {
  if (!props.groupId) {
    manifest.value = null
    clearSelection()
    return
  }

  if (showLoading) loading.value = true
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
    syncExpandedDirectories(
      nextManifest.workspaceTree?.length
        ? nextManifest.workspaceTree
        : buildWorkspaceTreeFromFiles(nextFiles),
      selectedStillExists?.path || props.initialPath || ''
    )

    if (!selectedStillExists) {
      clearSelection()
    } else if (
      shouldRefreshSelectedArtifact({
        previewVisible: Boolean(readResult.value),
        selectedPath: selectedPath.value,
        selectedFile: selectedStillExists,
        readResult: readResult.value,
      })
    ) {
      void loadFile(selectedStillExists.path, selectedStillExists.runId || undefined, {
        preserveCurrentContent: true,
      })
    }
  } catch (error: any) {
    manifest.value = null
    clearSelection()
    loadError.value = error?.message || '文件列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadFile(
  path: string,
  runId?: string | null,
  options: { preserveCurrentContent?: boolean } = {}
) {
  if (!props.groupId || !path) return

  const normalizedPath = normalizeWorkspacePath(path)
  const keepCurrentPreview =
    options.preserveCurrentContent &&
    normalizedSelectedPath.value === normalizedPath &&
    readResult.value !== null

  selectedPath.value = normalizedPath
  drawerPreviewVisible.value = true
  syncExpandedDirectories(workspaceTree.value, path)
  emit('file-selected', { path: normalizedPath, runId })
  if (!keepCurrentPreview) reading.value = true
  loadError.value = ''

  try {
    const res: any = await fetchArtifactReadAPI({
      groupId: props.groupId,
      path,
      runId: runId || undefined,
    })
    const nextReadResult = unwrapArtifactPayload<ArtifactReadResult>(res)
    if (!nextReadResult) throw new Error('文件内容返回格式不正确')
    readResult.value = nextReadResult
    emit('preview-ready', nextReadResult)
  } catch (error: any) {
    if (!keepCurrentPreview) {
      readResult.value = null
      emit('preview-ready', null)
    }
    loadError.value = error?.message || '文件读取失败'
  } finally {
    if (!keepCurrentPreview) reading.value = false
  }
}

watch(
  () => props.groupId,
  groupId => {
    if (groupId) {
      void loadArtifacts(true)
    } else {
      manifest.value = null
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
    if (normalizedSelectedPath.value === normalizedInitialPath && readResult.value) return
    syncExpandedDirectories(workspaceTree.value, matchedFile.path)
    void loadFile(matchedFile.path, matchedFile.runId)
  },
  { immediate: true }
)

watch(
  () => props.isStreaming,
  () => {
    startPolling()
  }
)

onBeforeUnmount(() => {
  clearPolling()
})
</script>

<template>
  <div
    class="artifact-workspace flex h-full min-h-0 flex-col"
    :class="mode === 'drawer' ? 'artifact-workspace-drawer' : 'artifact-workspace-panel'"
  >
    <div class="artifact-workspace-summary" v-if="mode === 'panel'">
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          工作区文件
        </div>
        <div class="truncate text-xs text-gray-500 dark:text-gray-400">
          {{ isStreaming ? '任务执行中，文件会自动刷新' : workspaceLabel }}
        </div>
      </div>
      <span class="artifact-workspace-count">{{ workspaceFiles.length }}</span>
    </div>

    <div class="artifact-filter-row">
      <button
        v-for="filter in fileFilters"
        :key="filter.key"
        class="artifact-filter-chip"
        :class="{ 'artifact-filter-chip-active': activeFilter === filter.key }"
        type="button"
        @click="activeFilter = filter.key"
      >
        {{ filter.label }}
        <span v-if="filterCountMap[filter.key]" class="artifact-chip-count">
          {{ filterCountMap[filter.key] }}
        </span>
      </button>
    </div>

    <section class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div v-if="loadError && !readResult" class="artifact-inline-error">
        {{ loadError }}
      </div>

      <div v-if="loading" class="artifact-loading-list">
        <div v-for="index in 4" :key="index" class="artifact-file-skeleton" />
      </div>

      <template v-else-if="treeRows.length">
        <div
          v-for="row in treeRows"
          :key="`${row.node.nodeType}:${row.node.path}`"
          class="artifact-file-row"
          :class="{
            'artifact-directory-row': row.node.nodeType === 'directory',
            'artifact-file-row-active':
              row.node.nodeType === 'file' && selectedPath === row.node.path,
          }"
          :style="{ paddingLeft: `${12 + row.depth * 16}px` }"
          role="button"
          tabindex="0"
          @click="
            row.node.nodeType === 'directory'
              ? toggleDirectory(row.node.path)
              : loadFile(row.node.path, row.node.runId)
          "
          @keydown.enter.prevent="
            row.node.nodeType === 'directory'
              ? toggleDirectory(row.node.path)
              : loadFile(row.node.path, row.node.runId)
          "
          @keydown.space.prevent="
            row.node.nodeType === 'directory'
              ? toggleDirectory(row.node.path)
              : loadFile(row.node.path, row.node.runId)
          "
        >
          <div class="artifact-file-row-main">
            <div class="artifact-file-left">
              <div
                v-if="row.node.nodeType === 'directory'"
                class="artifact-tree-toggle"
                :class="{ 'artifact-tree-toggle-open': isDirectoryExpanded(row.node.path) }"
              >
                ›
              </div>
              <div v-else class="artifact-tree-spacer" />

              <div
                class="artifact-file-type"
                :class="
                  row.node.nodeType === 'directory'
                    ? 'workspace-badge-folder'
                    : resolveFileMeta(row.node).badgeClass
                "
              >
                {{ row.node.nodeType === 'directory' ? '目' : resolveFileMeta(row.node).badge }}
              </div>

              <div class="min-w-0">
                <div class="artifact-file-name">{{ row.node.name }}</div>
                <div class="artifact-file-time">{{ formatTimeLabel(row.node.updatedAt) }}</div>
              </div>
            </div>

            <span class="artifact-file-tag">
              {{ row.node.nodeType === 'directory' ? '目录' : resolveFileMeta(row.node).label }}
            </span>
          </div>
        </div>
      </template>

      <div v-else class="artifact-empty-state">
        <div class="artifact-empty-title">当前任务还没有可见文件</div>
        <div class="artifact-empty-text">
          这里会直接显示当前对话工作区中的文档、代码文件、图片和链接。
        </div>
      </div>
    </section>

    <transition name="artifact-preview-modal">
      <section v-if="mode === 'drawer' && drawerPreviewVisible" class="artifact-preview-modal">
        <header class="artifact-modal-topbar">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ selectedFile?.name || readResult?.path || '文件预览' }}
            </div>
            <div class="truncate text-xs text-gray-500 dark:text-gray-400">
              {{ selectedFile?.path || readResult?.path }}
            </div>
          </div>
          <button class="artifact-modal-close" type="button" @click="drawerPreviewVisible = false">
            ×
          </button>
        </header>

        <div v-if="reading" class="grid gap-3 p-5">
          <div class="artifact-preview-skeleton artifact-preview-skeleton-lg" />
          <div class="artifact-preview-skeleton" />
        </div>
        <RuntimePreviewPane
          v-else
          class="min-h-0 flex-1 rounded-none border-0"
          :file="readResult"
        />
      </section>
    </transition>
  </div>
</template>

<style scoped>
.artifact-workspace {
  color: var(--artifact-text, #111827);
}

.artifact-workspace-summary {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--artifact-border, rgba(15, 23, 42, 0.1));
  padding: 10px 16px;
}

.artifact-workspace-count {
  border-radius: 999px;
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.05));
  padding: 4px 9px;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  font-size: 12px;
  font-weight: 700;
}

.artifact-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 16px;
}

.artifact-filter-chip {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--artifact-border, rgba(15, 23, 42, 0.1));
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.04));
  padding: 0 12px;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  font-size: 12px;
  font-weight: 700;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.artifact-filter-chip:hover,
.artifact-filter-chip-active {
  border-color: var(--artifact-border-strong, rgba(59, 130, 246, 0.28));
  background: var(--artifact-chip-active-bg, rgba(37, 99, 235, 0.12));
  color: var(--artifact-chip-active-text, #1d4ed8);
}

.artifact-chip-count {
  opacity: 0.72;
}

.artifact-loading-list {
  display: grid;
  gap: 8px;
}

.artifact-file-skeleton,
.artifact-preview-skeleton {
  border-radius: 12px;
  background: linear-gradient(
    90deg,
    var(--artifact-skeleton-a, rgba(226, 232, 240, 0.72)),
    var(--artifact-skeleton-b, rgba(248, 250, 252, 0.96)),
    var(--artifact-skeleton-a, rgba(226, 232, 240, 0.72))
  );
  background-size: 200% 100%;
  animation: artifactShimmer 1.4s linear infinite;
}

.artifact-file-skeleton {
  height: 62px;
}

.artifact-preview-skeleton {
  height: 72px;
}

.artifact-preview-skeleton-lg {
  height: 240px;
}

.artifact-file-row {
  width: 100%;
  margin-bottom: 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--artifact-surface, rgba(255, 255, 255, 0.76));
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  transition:
    background 160ms ease,
    border-color 160ms ease;
}

.artifact-file-row:hover {
  border-color: var(--artifact-border, rgba(15, 23, 42, 0.1));
  background: var(--artifact-surface-hover, rgba(241, 245, 249, 0.92));
}

.artifact-file-row-active {
  border-color: var(--artifact-border-strong, rgba(59, 130, 246, 0.28));
  background: var(--artifact-surface-active, rgba(239, 246, 255, 0.96));
}

.artifact-directory-row {
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.04));
}

.artifact-file-row-main,
.artifact-file-left {
  display: flex;
  min-width: 0;
  align-items: center;
}

.artifact-file-row-main {
  justify-content: space-between;
  gap: 10px;
}

.artifact-file-left {
  gap: 10px;
}

.artifact-tree-toggle,
.artifact-tree-spacer {
  display: inline-flex;
  width: 16px;
  flex: 0 0 16px;
  justify-content: center;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  transition: transform 160ms ease;
}

.artifact-tree-toggle-open {
  transform: rotate(90deg);
}

.artifact-file-type {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 800;
}

.workspace-badge-doc {
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.04));
  color: var(--artifact-text, #111827);
}

.workspace-badge-folder {
  background: rgba(245, 158, 11, 0.14);
  color: #92400e;
}

.workspace-badge-code {
  background: rgba(37, 99, 235, 0.14);
  color: #1d4ed8;
}

.workspace-badge-image {
  background: rgba(22, 163, 74, 0.14);
  color: #15803d;
}

.workspace-badge-link {
  background: rgba(219, 39, 119, 0.14);
  color: #be185d;
}

.artifact-file-name {
  overflow: hidden;
  color: var(--artifact-text, #111827);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-file-time {
  margin-top: 2px;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  font-size: 11px;
}

.artifact-file-tag {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.04));
  padding: 4px 8px;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  font-size: 11px;
  font-weight: 700;
}

.artifact-empty-state,
.artifact-inline-error {
  border-radius: 14px;
  padding: 16px;
}

.artifact-empty-state {
  border: 1px dashed var(--artifact-border, rgba(15, 23, 42, 0.1));
  background: var(--artifact-control-bg, rgba(15, 23, 42, 0.04));
}

.artifact-inline-error {
  margin-bottom: 12px;
  border: 1px solid var(--artifact-danger-border, rgba(239, 68, 68, 0.18));
  background: var(--artifact-danger-bg, rgba(239, 68, 68, 0.08));
  color: var(--artifact-danger-text, #b91c1c);
}

.artifact-empty-title {
  color: var(--artifact-text, #111827);
  font-size: 14px;
  font-weight: 700;
}

.artifact-empty-text {
  margin-top: 6px;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  font-size: 12px;
  line-height: 1.7;
}

.artifact-preview-modal {
  position: fixed;
  inset: 22px;
  z-index: 70;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--artifact-panel-border, rgba(15, 23, 42, 0.08));
  background: var(--artifact-modal-bg, #fff);
  box-shadow: var(--artifact-panel-shadow, 0 22px 80px rgba(15, 23, 42, 0.16));
}

.artifact-modal-topbar {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--artifact-border, rgba(15, 23, 42, 0.1));
  background: var(--artifact-modal-topbar-bg, rgba(255, 255, 255, 0.92));
  padding: 10px 14px 10px 18px;
}

.artifact-modal-close {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--artifact-muted, rgba(51, 65, 85, 0.66));
  cursor: pointer;
  font-size: 22px;
}

.artifact-preview-modal-enter-active,
.artifact-preview-modal-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms ease;
}

.artifact-preview-modal-enter-from,
.artifact-preview-modal-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

@keyframes artifactShimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 1024px) {
  .artifact-preview-modal {
    inset: 10px;
    border-radius: 18px;
  }
}
</style>
