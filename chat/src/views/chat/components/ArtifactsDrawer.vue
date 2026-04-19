<script setup lang="ts">
import { fetchArtifactListAPI, fetchArtifactReadAPI } from '@/api/artifacts'
import { useAppStore } from '@/store'
import { getArtifactMarkdownTheme, shouldRefreshSelectedArtifact } from '@/utils/artifactPreview'
import { message } from '@/utils/message'
import { Close } from '@icon-park/vue-next'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WechatPublishModal from './WechatPublishModal.vue'

interface ArtifactFileItem {
  name: string
  path: string
  preview?: string
  size: number
  type: string
  updatedAt: string
}

interface ArtifactWorkspaceFileItem extends ArtifactFileItem {
  runId: string | null
  source?: 'artifacts_root' | 'workspace_root' | 'workspace_loose' | string
}

interface ArtifactWorkspaceDirectoryItem {
  children: ArtifactWorkspaceTreeItem[]
  name: string
  nodeType: 'directory'
  path: string
  updatedAt: string
}

interface ArtifactWorkspaceTreeFileItem extends ArtifactWorkspaceFileItem {
  nodeType: 'file'
}

type ArtifactWorkspaceTreeItem = ArtifactWorkspaceDirectoryItem | ArtifactWorkspaceTreeFileItem

interface ArtifactRunItem {
  runId: string
  files: ArtifactFileItem[]
  source?: 'artifacts_root' | 'workspace_root' | string
}

interface ArtifactManifest {
  artifactsRoot: string
  runs: ArtifactRunItem[]
  workspaceDir: string
  workspaceRootMode?: 'data' | 'conversation'
  workspaceFiles?: ArtifactWorkspaceFileItem[]
  workspaceTree?: ArtifactWorkspaceTreeItem[]
}

interface ArtifactReadResult {
  content: string
  path: string
  run_id?: string | null
  size: number
  truncated: boolean
  type: string
  updatedAt: string
}

interface LoadFileOptions {
  preserveCurrentContent?: boolean
  switchPreview?: boolean
}

type FileFilterKey = 'all' | 'document' | 'image' | 'code' | 'link'

interface FileFilterItem {
  key: FileFilterKey
  label: string
}

interface ArtifactTreeRow {
  depth: number
  node: ArtifactWorkspaceTreeItem
}

const props = defineProps<{
  visible: boolean
  groupId: number
  isStreaming: boolean
  initialPath?: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const appStore = useAppStore()
const ms = message()

const manifest = ref<ArtifactManifest | null>(null)
const loading = ref(false)
const reading = ref(false)
const loadError = ref('')
const selectedPath = ref('')
const readResult = ref<ArtifactReadResult | null>(null)
const activeFilter = ref<FileFilterKey>('all')
const previewVisible = ref(false)
const wechatPublishVisible = ref(false)
const previewMode = ref<'preview' | 'code'>('preview')
const previewFullscreen = ref(false)
const pollTimer = ref<number | null>(null)
const expandedDirectories = ref<string[]>([])

const fileFilters: FileFilterItem[] = [
  { key: 'all', label: '全部' },
  { key: 'document', label: '文档' },
  { key: 'image', label: '图片' },
  { key: 'code', label: '代码文件' },
  { key: 'link', label: '链接' },
]

function unwrapPayload<T>(payload: any): T | null {
  if (!payload || typeof payload !== 'object') return null
  if (
    'runs' in payload ||
    'workspaceFiles' in payload ||
    'workspaceTree' in payload ||
    'content' in payload
  )
    return payload as T
  if ('data' in payload) return unwrapPayload<T>(payload.data)
  return null
}

const drawerClass = computed(() => {
  return props.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none'
})

const isDarkTheme = computed(() => {
  if (appStore.theme === 'dark') return true
  if (typeof document === 'undefined') return false
  const html = document.documentElement
  return html.classList.contains('dark') || html.dataset.theme === 'dark'
})

const markdownPreviewTheme = computed(() => getArtifactMarkdownTheme(isDarkTheme.value))

const workspaceFiles = computed<ArtifactWorkspaceFileItem[]>(() => {
  const directFiles = manifest.value?.workspaceFiles
  if (directFiles?.length) {
    return directFiles.slice().sort((left, right) => {
      const byTime = right.updatedAt.localeCompare(left.updatedAt)
      if (byTime !== 0) return byTime
      return left.path.localeCompare(right.path)
    })
  }

  return (manifest.value?.runs || [])
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
    .sort((left, right) => {
      const byTime = right.updatedAt.localeCompare(left.updatedAt)
      if (byTime !== 0) return byTime
      return left.path.localeCompare(right.path)
    })
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

const normalizedSelectedPath = computed(() => normalizeWorkspacePath(selectedPath.value))

const selectedFile = computed(
  () => workspaceFiles.value.find(file => file.path === normalizedSelectedPath.value) || null
)

function sortWorkspaceTree(nodes: ArtifactWorkspaceTreeItem[]): ArtifactWorkspaceTreeItem[] {
  return nodes
    .slice()
    .sort((left, right) => {
      if (left.nodeType !== right.nodeType) {
        return left.nodeType === 'directory' ? -1 : 1
      }

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

function buildWorkspaceTreeFromFiles(files: ArtifactWorkspaceFileItem[]) {
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
      } else if (directory.updatedAt.localeCompare(file.updatedAt) < 0) {
        directory.updatedAt = file.updatedAt
      }

      currentChildren = directory.children
    })

    currentChildren.push({
      ...file,
      nodeType: 'file',
    })
  })

  return sortWorkspaceTree(root)
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

  if (file.type === 'image' || imageExtensions.includes(ext)) return 'image'
  if (file.type === 'html' || codeExtensions.includes(ext)) return 'code'
  if (linkExtensions.includes(ext)) return 'link'
  if ((file.preview || '').startsWith('http://') || (file.preview || '').startsWith('https://'))
    return 'link'
  return 'document'
}

function resolveFileMeta(file: ArtifactWorkspaceFileItem) {
  const filterKey = resolveFilterKey(file)

  if (filterKey === 'image') {
    return {
      badge: '图',
      badgeClass: 'artifact-badge-image',
      label: '图片',
    }
  }

  if (filterKey === 'code') {
    return {
      badge: '</>',
      badgeClass: 'artifact-badge-code',
      label: '代码文件',
    }
  }

  if (filterKey === 'link') {
    return {
      badge: '链',
      badgeClass: 'artifact-badge-link',
      label: '链接',
    }
  }

  return {
    badge: '文',
    badgeClass: 'artifact-badge-doc',
    label: '文档',
  }
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

      const children: ArtifactWorkspaceTreeItem[] = filterWorkspaceTree(node.children, filterKey)
      if (!children.length) return null
      return {
        ...node,
        children,
      }
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

const filterCountMap = computed<Record<FileFilterKey, number>>(() => {
  const countMap: Record<FileFilterKey, number> = {
    all: workspaceFiles.value.length,
    document: 0,
    image: 0,
    code: 0,
    link: 0,
  }

  workspaceFiles.value.forEach(file => {
    const key = resolveFilterKey(file)
    countMap[key] += 1
  })

  return countMap
})

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

function formatBytes(size?: number) {
  if (!size && size !== 0) return '--'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const workspaceTree = computed<ArtifactWorkspaceTreeItem[]>(() => {
  const directTree = manifest.value?.workspaceTree
  if (directTree?.length) return sortWorkspaceTree(directTree)
  return buildWorkspaceTreeFromFiles(workspaceFiles.value)
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

const formattedCodeContent = computed(() => {
  if (!readResult.value) return ''
  if (readResult.value.type !== 'json') return readResult.value.content

  try {
    return JSON.stringify(JSON.parse(readResult.value.content), null, 2)
  } catch (_error) {
    return readResult.value.content
  }
})

const imageSource = computed(() => {
  if (!readResult.value) return ''
  return `data:image/*;base64,${readResult.value.content}`
})

const canPreviewSelectedFile = computed(() => {
  if (!readResult.value) return false
  return ['markdown', 'html', 'image'].includes(readResult.value.type)
})

function isWechatPublishTarget(path: string, fileType?: string) {
  if (fileType && fileType !== 'markdown') return false
  const normalizedPath = path.split('/').pop() || path
  return (
    normalizedPath === '08_writer.md' ||
    /^99_.*正式稿\.md$/u.test(normalizedPath) ||
    /\.wechat\.md$/i.test(normalizedPath)
  )
}

const canPublishSelectedFile = computed(() => {
  if (!selectedFile.value || !readResult.value) return false
  return isWechatPublishTarget(selectedFile.value.path, readResult.value.type)
})

function clearSelection() {
  selectedPath.value = ''
  readResult.value = null
  previewVisible.value = false
  wechatPublishVisible.value = false
  previewMode.value = 'preview'
  previewFullscreen.value = false
}

function clearPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

function startPolling() {
  clearPolling()
  if (!props.visible || !props.groupId || !props.isStreaming) return

  pollTimer.value = window.setInterval(() => {
    void loadArtifacts(false)
  }, 3000)
}

async function copyText(content: string, successText: string) {
  try {
    await navigator.clipboard.writeText(content)
    ms.success(successText)
  } catch (_error) {
    ms.error('复制失败，请稍后重试')
  }
}

function downloadCurrentFile() {
  if (!readResult.value || !selectedFile.value) return

  const typeMap: Record<string, string> = {
    json: 'application/json',
    html: 'text/html;charset=utf-8',
    image: 'image/*',
    markdown: 'text/markdown;charset=utf-8',
    text: 'text/plain;charset=utf-8',
  }

  const blob = new Blob([readResult.value.content], {
    type: typeMap[readResult.value.type] || 'application/octet-stream',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = selectedFile.value.name
  link.click()
  URL.revokeObjectURL(url)
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
    const res: any = await fetchArtifactListAPI({
      groupId: props.groupId,
    })
    const nextManifest = unwrapPayload<ArtifactManifest>(res)
    if (!nextManifest) throw new Error('文件列表返回格式不正确')

    manifest.value = nextManifest

    const nextFiles = nextManifest.workspaceFiles?.length
      ? nextManifest.workspaceFiles
      : nextManifest.runs.flatMap(run =>
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
        previewVisible: previewVisible.value,
        selectedPath: selectedPath.value,
        selectedFile: selectedStillExists,
        readResult: readResult.value,
      })
    ) {
      void loadFile(selectedStillExists.path, selectedStillExists.runId || undefined, {
        switchPreview: false,
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

async function loadFile(path: string, runId?: string, options: LoadFileOptions = {}) {
  if (!props.groupId || !path) return

  const { switchPreview = true, preserveCurrentContent = false } = options
  const normalizedPath = normalizeWorkspacePath(path)
  const keepCurrentPreview =
    preserveCurrentContent &&
    previewVisible.value &&
    normalizedSelectedPath.value === normalizedPath &&
    readResult.value !== null

  selectedPath.value = normalizedPath
  syncExpandedDirectories(workspaceTree.value, path)
  if (!keepCurrentPreview) reading.value = true
  loadError.value = ''
  if (switchPreview) previewVisible.value = true

  try {
    const res: any = await fetchArtifactReadAPI({
      groupId: props.groupId,
      path,
      runId,
    })
    const nextReadResult = unwrapPayload<ArtifactReadResult>(res)
    if (!nextReadResult) throw new Error('文件内容返回格式不正确')
    readResult.value = nextReadResult
    previewMode.value = ['markdown', 'html', 'image'].includes(nextReadResult.type)
      ? 'preview'
      : 'code'
  } catch (error: any) {
    if (!keepCurrentPreview) {
      readResult.value = null
    }
    loadError.value = error?.message || '文件读取失败'
  } finally {
    if (!keepCurrentPreview) reading.value = false
  }
}

watch(
  () => [props.visible, props.groupId] as const,
  ([visible, groupId]) => {
    if (!visible) {
      clearPolling()
      return
    }

    if (groupId) {
      void loadArtifacts(true)
    }
    startPolling()
  },
  { immediate: true }
)

watch(
  () => [props.visible, props.initialPath, workspaceFiles.value.length] as const,
  ([visible, initialPath]) => {
    if (!visible || !initialPath) return
    const normalizedInitialPath = normalizeWorkspacePath(initialPath)
    const matchedFile = workspaceFiles.value.find(file => file.path === normalizedInitialPath)
    if (!matchedFile) return
    if (normalizedSelectedPath.value === normalizedInitialPath && previewVisible.value) return
    syncExpandedDirectories(workspaceTree.value, matchedFile.path)
    void loadFile(matchedFile.path, matchedFile.runId || undefined)
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
  <transition name="artifact-backdrop">
    <div
      v-if="visible"
      class="artifact-backdrop-layer fixed inset-0 z-40 backdrop-blur-[4px]"
      :class="{ 'artifact-backdrop-layer-dark': isDarkTheme }"
      @click="emit('close')"
    />
  </transition>

  <aside
    class="artifact-drawer fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 transition-all duration-300 ease-out"
    :class="[drawerClass, { 'artifact-drawer-dark': isDarkTheme }]"
  >
    <div class="artifact-panel" @click.stop>
      <header class="artifact-header">
        <div class="min-w-0">
          <h2 class="artifact-title">此任务中的所有文件</h2>
          <p class="artifact-subtitle">
            {{ props.isStreaming ? '文件会在任务执行过程中持续出现' : workspaceLabel }}
          </p>
        </div>

        <div class="artifact-header-actions">
          <button class="artifact-close-btn" @click="emit('close')">
            <Close size="18" />
          </button>
        </div>
      </header>

      <div class="artifact-filter-row">
        <button
          v-for="filter in fileFilters"
          :key="filter.key"
          class="artifact-filter-chip"
          :class="{ 'artifact-filter-chip-active': activeFilter === filter.key }"
          @click="activeFilter = filter.key"
        >
          {{ filter.label }}
          <span v-if="filterCountMap[filter.key]" class="artifact-chip-count">
            {{ filterCountMap[filter.key] }}
          </span>
        </button>
      </div>

      <div class="artifact-body">
        <section class="artifact-list-view">
          <div v-if="loadError && !previewVisible" class="artifact-inline-error">
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
                  row.node.nodeType === 'file' && selectedPath === row.node.path && previewVisible,
              }"
              :style="{ paddingLeft: `${16 + row.depth * 18}px` }"
              role="button"
              tabindex="0"
              @click="
                row.node.nodeType === 'directory'
                  ? toggleDirectory(row.node.path)
                  : loadFile(row.node.path, row.node.runId || undefined)
              "
              @keydown.enter.prevent="
                row.node.nodeType === 'directory'
                  ? toggleDirectory(row.node.path)
                  : loadFile(row.node.path, row.node.runId || undefined)
              "
              @keydown.space.prevent="
                row.node.nodeType === 'directory'
                  ? toggleDirectory(row.node.path)
                  : loadFile(row.node.path, row.node.runId || undefined)
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
                        ? 'artifact-badge-folder'
                        : resolveFileMeta(row.node).badgeClass
                    "
                  >
                    <span
                      v-if="row.node.nodeType === 'directory'"
                      class="artifact-folder-icon"
                      :class="{ 'artifact-folder-icon-open': isDirectoryExpanded(row.node.path) }"
                      aria-hidden="true"
                    />
                    <template v-else>
                      {{ resolveFileMeta(row.node).badge }}
                    </template>
                  </div>

                  <div class="min-w-0">
                    <div class="artifact-file-name">{{ row.node.name }}</div>
                    <div class="artifact-file-time">
                      {{ formatTimeLabel(row.node.updatedAt) }}
                    </div>
                  </div>
                </div>

                <div class="artifact-file-right">
                  <span class="artifact-file-tag">
                    {{
                      row.node.nodeType === 'directory' ? '目录' : resolveFileMeta(row.node).label
                    }}
                  </span>
                </div>
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
      </div>
    </div>

    <transition name="artifact-preview-modal">
      <section
        v-if="previewVisible"
        class="artifact-preview-modal"
        :class="{ 'artifact-preview-modal-fullscreen': previewFullscreen }"
        @click.stop
      >
        <header class="artifact-modal-topbar">
          <div v-if="selectedFile" class="artifact-modal-fileinfo">
            <div class="artifact-modal-file-icon" :class="resolveFileMeta(selectedFile).badgeClass">
              {{ resolveFileMeta(selectedFile).badge }}
            </div>
            <div class="min-w-0">
              <div class="artifact-modal-filename">{{ selectedFile.name }}</div>
              <div class="artifact-modal-meta">
                <span>{{ formatTimeLabel(selectedFile.updatedAt) }}</span>
                <span>{{ formatBytes(selectedFile.size) }}</span>
                <span>{{ selectedFile.path }}</span>
              </div>
            </div>
          </div>

          <div class="artifact-modal-toolbar">
            <div class="artifact-mode-switch">
              <button
                class="artifact-mode-btn"
                :class="{ 'artifact-mode-btn-active': previewMode === 'preview' }"
                :disabled="!canPreviewSelectedFile"
                @click="previewMode = 'preview'"
              >
                预览
              </button>
              <button
                class="artifact-mode-btn"
                :class="{ 'artifact-mode-btn-active': previewMode === 'code' }"
                @click="previewMode = 'code'"
              >
                代码
              </button>
            </div>

            <button
              v-if="canPublishSelectedFile"
              class="artifact-publish-btn"
              @click="wechatPublishVisible = true"
            >
              发布到公众号
            </button>

            <button
              v-if="selectedFile"
              class="artifact-modal-icon-btn"
              title="复制路径"
              @click="copyText(selectedFile.path, '文件路径已复制')"
            >
              ···
            </button>
            <button
              v-if="readResult"
              class="artifact-modal-icon-btn"
              title="下载"
              @click="downloadCurrentFile"
            >
              ↓
            </button>
            <button
              class="artifact-modal-icon-btn"
              :title="previewFullscreen ? '退出全屏' : '放大预览'"
              @click="previewFullscreen = !previewFullscreen"
            >
              ⤢
            </button>
            <button class="artifact-modal-close" title="关闭" @click="clearSelection">×</button>
          </div>
        </header>

        <main class="artifact-modal-content">
          <div v-if="loadError" class="artifact-inline-error">
            {{ loadError }}
          </div>

          <div v-if="reading" class="artifact-preview-loading artifact-modal-loading">
            <div class="artifact-preview-skeleton artifact-preview-skeleton-lg" />
            <div class="artifact-preview-skeleton" />
            <div class="artifact-preview-skeleton" />
          </div>

          <template v-else-if="readResult && selectedFile">
            <div
              v-if="previewMode === 'preview' && readResult.type === 'markdown'"
              class="artifact-modal-doc-surface artifact-markdown-surface"
            >
              <MdPreview
                editor-id="artifact-modal-preview"
                :model-value="readResult.content"
                :theme="markdownPreviewTheme"
                preview-theme="github"
              />
            </div>

            <iframe
              v-else-if="previewMode === 'preview' && readResult.type === 'html'"
              class="artifact-modal-html-frame"
              :srcdoc="readResult.content"
              sandbox="allow-scripts allow-same-origin"
            />

            <div
              v-else-if="previewMode === 'preview' && readResult.type === 'image'"
              class="artifact-modal-image-surface"
            >
              <img class="artifact-image-preview" :src="imageSource" :alt="selectedFile.name" />
            </div>

            <pre
              v-else
              class="artifact-modal-code-surface"
            ><code>{{ formattedCodeContent }}</code></pre>

            <div v-if="readResult.truncated" class="artifact-warning-box">
              文件内容较长，当前只展示前 512KB。
            </div>
          </template>
        </main>
      </section>
    </transition>

    <WechatPublishModal
      v-if="selectedFile"
      :visible="wechatPublishVisible"
      :group-id="groupId"
      :path="selectedFile.path"
      :run-id="selectedFile.runId"
      @close="wechatPublishVisible = false"
      @published="wechatPublishVisible = false"
    />
  </aside>
</template>

<style scoped>
.artifact-backdrop-layer {
  background: rgba(15, 23, 42, 0.18);
}

:global(html.dark) .artifact-backdrop-layer,
:global(html[data-theme='dark']) .artifact-backdrop-layer,
.artifact-backdrop-layer-dark {
  background: rgba(0, 0, 0, 0.56);
}

.artifact-panel {
  position: relative;
  width: min(1080px, 100%);
  height: min(82vh, 860px);
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--artifact-panel-border);
  background: var(--artifact-panel-bg);
  box-shadow: var(--artifact-panel-shadow);
  color: var(--artifact-text);
}

.artifact-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 28px 28px 18px;
}

.artifact-title {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  color: var(--artifact-text);
}

.artifact-subtitle {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--artifact-muted);
}

.artifact-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artifact-close-btn,
.artifact-action-btn,
.artifact-back-btn {
  border: none;
  background: transparent;
  color: var(--artifact-muted);
  cursor: pointer;
}

.artifact-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border-radius: 999px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-control-bg);
  padding: 0 14px;
  font-size: 12px;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    transform 180ms ease;
}

.artifact-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  color: var(--artifact-muted);
}

.artifact-action-btn:hover,
.artifact-close-btn:hover,
.artifact-back-btn:hover {
  background: var(--artifact-control-hover);
  border-color: var(--artifact-border-strong);
  color: var(--artifact-text);
}

.artifact-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 28px 18px;
}

.artifact-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 999px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-control-bg);
  padding: 0 22px;
  font-size: 15px;
  font-weight: 600;
  color: var(--artifact-muted);
  transition:
    background 180ms ease,
    color 180ms ease,
    border-color 180ms ease,
    transform 180ms ease;
}

.artifact-filter-chip:hover {
  transform: translateY(-1px);
  border-color: var(--artifact-border-strong);
}

.artifact-filter-chip-active {
  background: var(--artifact-chip-active-bg);
  color: var(--artifact-chip-active-text);
  border-color: transparent;
}

.artifact-chip-count {
  font-size: 12px;
  opacity: 0.7;
}

.artifact-body {
  position: relative;
  height: calc(100% - 128px);
  overflow: hidden;
}

.artifact-list-view {
  height: 100%;
  overflow-y: auto;
  padding: 4px 28px 28px;
}

.artifact-list-condensed {
  padding-right: 360px;
}

.artifact-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 10px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: var(--artifact-surface);
  padding: 14px 16px;
  cursor: pointer;
  text-align: left;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    transform 180ms ease;
}

.artifact-file-row:hover {
  transform: translateY(-1px);
  background: var(--artifact-surface-hover);
  border-color: var(--artifact-border);
}

.artifact-file-row-active {
  background: var(--artifact-surface-active);
  border-color: var(--artifact-border-strong);
}

.artifact-directory-row {
  background: var(--artifact-control-bg);
}

.artifact-file-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
}

.artifact-file-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.artifact-tree-toggle,
.artifact-tree-spacer {
  display: inline-flex;
  width: 18px;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  color: var(--artifact-muted);
}

.artifact-tree-toggle {
  font-size: 18px;
  font-weight: 600;
  transform: translateY(-1px);
  transition: transform 180ms ease;
}

.artifact-tree-toggle-open {
  transform: rotate(90deg) translateX(-1px);
}

.artifact-file-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 800;
  flex-shrink: 0;
}

.artifact-badge-doc {
  background: var(--artifact-control-bg);
  color: var(--artifact-text);
}

.artifact-badge-folder {
  background:
    radial-gradient(circle at 70% 24%, rgba(255, 255, 255, 0.62), transparent 28%),
    linear-gradient(180deg, rgba(254, 243, 199, 0.92), rgba(251, 191, 36, 0.24));
  color: #92400e;
}

.artifact-folder-icon {
  position: relative;
  display: block;
  width: 30px;
  height: 24px;
  filter: drop-shadow(0 5px 7px rgba(146, 64, 14, 0.18));
  transform: translateY(1px);
  transition:
    filter 180ms ease,
    transform 180ms ease;
}

.artifact-folder-icon::before {
  position: absolute;
  top: 2px;
  left: 3px;
  width: 13px;
  height: 7px;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, #fde68a, #fbbf24);
  content: '';
}

.artifact-folder-icon::after {
  position: absolute;
  right: 0;
  bottom: 1px;
  left: 0;
  height: 18px;
  border-radius: 7px 8px 9px 9px;
  background: linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -7px 12px rgba(146, 64, 14, 0.14);
  content: '';
}

.artifact-folder-icon-open {
  filter: drop-shadow(0 7px 10px rgba(146, 64, 14, 0.22));
  transform: translateY(1px) rotate(-2deg);
}

.artifact-badge-code {
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.9), rgba(59, 130, 246, 0.88));
  color: white;
}

.artifact-badge-image {
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.9), rgba(22, 163, 74, 0.88));
  color: white;
}

.artifact-badge-link {
  background: linear-gradient(180deg, rgba(244, 114, 182, 0.9), rgba(236, 72, 153, 0.88));
  color: white;
}

.artifact-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 600;
  color: var(--artifact-text);
}

.artifact-file-time {
  margin-top: 4px;
  font-size: 13px;
  color: var(--artifact-muted);
}

.artifact-file-right {
  margin-left: 12px;
}

.artifact-file-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--artifact-muted);
  background: var(--artifact-control-bg);
}

.artifact-loading-list {
  display: grid;
  gap: 10px;
}

.artifact-file-skeleton,
.artifact-preview-skeleton {
  border-radius: 18px;
  background: linear-gradient(
    90deg,
    var(--artifact-skeleton-a),
    var(--artifact-skeleton-b),
    var(--artifact-skeleton-a)
  );
  background-size: 200% 100%;
  animation: artifactShimmer 1.4s linear infinite;
}

.artifact-file-skeleton {
  height: 82px;
}

.artifact-preview-skeleton {
  height: 72px;
}

.artifact-preview-skeleton-lg {
  height: 240px;
}

.artifact-empty-state,
.artifact-inline-error {
  border-radius: 20px;
  padding: 20px;
}

.artifact-empty-state {
  margin-top: 10px;
  background: var(--artifact-control-bg);
  border: 1px dashed var(--artifact-border);
}

.artifact-inline-error {
  margin-bottom: 14px;
  background: var(--artifact-danger-bg);
  border: 1px solid var(--artifact-danger-border);
  color: var(--artifact-danger-text);
}

.artifact-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--artifact-text);
}

.artifact-empty-text {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--artifact-muted);
}

.artifact-preview-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: min(360px, 100%);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--artifact-border);
  background: var(--artifact-modal-bg);
  backdrop-filter: blur(18px);
}

.artifact-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 12px;
}

.artifact-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  border-radius: 999px;
  padding: 0 12px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-control-bg);
  font-size: 12px;
}

.artifact-preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artifact-preview-filebar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px 16px;
}

.artifact-preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  color: var(--artifact-text);
}

.artifact-preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--artifact-muted);
}

.artifact-preview-loading {
  display: grid;
  gap: 10px;
  padding: 0 18px 18px;
}

.artifact-preview-surface,
.artifact-code-surface {
  margin: 0 18px 18px;
  border-radius: 18px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-control-bg);
  overflow: hidden;
}

.artifact-markdown-surface {
  padding: 12px;
}

.artifact-html-surface {
  min-height: 320px;
}

.artifact-html-frame {
  width: 100%;
  min-height: 480px;
  border: none;
  background: white;
}

.artifact-image-surface {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.artifact-image-preview {
  max-width: 100%;
  border-radius: 14px;
}

.artifact-code-surface {
  padding: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.7;
  color: var(--artifact-code-text);
}

.artifact-warning-box {
  margin: 0 18px 18px;
  border-radius: 14px;
  background: var(--artifact-warning-bg);
  border: 1px solid var(--artifact-warning-border);
  padding: 12px 14px;
  font-size: 12px;
  color: var(--artifact-warning-text);
}

.artifact-preview-modal {
  position: fixed;
  inset: 22px;
  z-index: 70;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  border: 1px solid var(--artifact-panel-border);
  background: var(--artifact-modal-bg);
  box-shadow: var(--artifact-panel-shadow);
}

.artifact-preview-modal-fullscreen {
  inset: 0;
  border-radius: 0;
}

.artifact-modal-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 74px;
  border-bottom: 1px solid var(--artifact-border);
  background: var(--artifact-modal-topbar-bg);
  padding: 14px 18px 14px 22px;
}

.artifact-modal-fileinfo {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}

.artifact-modal-file-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
}

.artifact-modal-filename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 17px;
  font-weight: 700;
  color: var(--artifact-text);
}

.artifact-modal-meta {
  display: flex;
  max-width: min(620px, 52vw);
  gap: 10px;
  margin-top: 4px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  color: var(--artifact-muted);
}

.artifact-modal-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.artifact-modal-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.artifact-publish-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border-radius: 999px;
  padding: 0 14px;
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 12px 28px rgba(15, 118, 110, 0.18);
}

.artifact-mode-switch {
  display: inline-flex;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-control-bg);
  padding: 3px;
}

.artifact-mode-btn {
  min-width: 70px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--artifact-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.artifact-mode-btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.artifact-mode-btn-active {
  background: var(--artifact-mode-active-bg);
  color: var(--artifact-mode-active-text);
  box-shadow: var(--artifact-control-shadow);
}

.artifact-modal-icon-btn,
.artifact-modal-close {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--artifact-muted);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  transition:
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.artifact-modal-icon-btn:hover,
.artifact-modal-close:hover {
  transform: translateY(-1px);
  background: var(--artifact-control-hover);
  color: var(--artifact-text);
}

.artifact-modal-content {
  min-height: 0;
  flex: 1;
  overflow: auto;
  background: var(--artifact-modal-content-bg);
}

.artifact-modal-loading {
  padding: 28px;
}

.artifact-modal-doc-surface {
  min-height: 100%;
  border: none;
  border-radius: 0;
  background: var(--artifact-doc-bg);
  padding: 44px min(14vw, 180px);
}

.artifact-modal-html-frame {
  display: block;
  width: 100%;
  min-height: calc(100vh - 118px);
  border: 0;
  background: white;
}

.artifact-modal-image-surface {
  display: grid;
  min-height: calc(100vh - 118px);
  place-items: center;
  padding: 28px;
}

.artifact-modal-code-surface {
  min-height: 100%;
  margin: 0;
  overflow: auto;
  background: var(--artifact-code-bg);
  padding: 28px 32px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--artifact-code-text);
  font-size: 13px;
  line-height: 1.8;
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

.artifact-drawer {
  --artifact-panel-bg:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98));
  --artifact-panel-border: rgba(15, 23, 42, 0.08);
  --artifact-panel-shadow: 0 22px 80px rgba(15, 23, 42, 0.16);
  --artifact-surface: rgba(255, 255, 255, 0.76);
  --artifact-surface-strong: rgba(255, 255, 255, 0.95);
  --artifact-surface-hover: rgba(241, 245, 249, 0.92);
  --artifact-surface-active: rgba(239, 246, 255, 0.96);
  --artifact-border: rgba(15, 23, 42, 0.1);
  --artifact-border-strong: rgba(59, 130, 246, 0.28);
  --artifact-text: #111827;
  --artifact-muted: rgba(51, 65, 85, 0.66);
  --artifact-faint: rgba(100, 116, 139, 0.5);
  --artifact-inverse-text: #ffffff;
  --artifact-chip-active-bg: rgba(37, 99, 235, 0.12);
  --artifact-chip-active-text: #1d4ed8;
  --artifact-mode-active-bg: #ffffff;
  --artifact-mode-active-text: #0f172a;
  --artifact-modal-bg:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.08), transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(248, 250, 252, 0.99));
  --artifact-modal-topbar-bg: rgba(255, 255, 255, 0.92);
  --artifact-modal-content-bg: #f8fafc;
  --artifact-doc-bg: #ffffff;
  --artifact-code-bg: #ffffff;
  --artifact-code-text: #0f172a;
  --artifact-code-border: rgba(15, 23, 42, 0.08);
  --artifact-markdown-code-bg: rgba(15, 23, 42, 0.06);
  --artifact-markdown-block-bg: rgba(248, 250, 252, 0.92);
  --artifact-table-head-bg: rgba(226, 232, 240, 0.9);
  --artifact-table-row-bg: rgba(255, 255, 255, 0.88);
  --artifact-table-row-alt-bg: rgba(248, 250, 252, 0.98);
  --artifact-control-bg: rgba(15, 23, 42, 0.04);
  --artifact-control-hover: rgba(15, 23, 42, 0.08);
  --artifact-control-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  --artifact-danger-bg: rgba(239, 68, 68, 0.08);
  --artifact-danger-border: rgba(239, 68, 68, 0.18);
  --artifact-danger-text: #b91c1c;
  --artifact-warning-bg: rgba(245, 158, 11, 0.12);
  --artifact-warning-border: rgba(245, 158, 11, 0.2);
  --artifact-warning-text: #92400e;
  --artifact-skeleton-a: rgba(226, 232, 240, 0.72);
  --artifact-skeleton-b: rgba(248, 250, 252, 0.96);
}

:global(html.dark) .artifact-drawer,
:global(html[data-theme='dark']) .artifact-drawer,
.artifact-drawer-dark {
  --artifact-panel-bg:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.05), transparent 28%),
    linear-gradient(180deg, rgba(42, 42, 42, 0.98), rgba(32, 32, 32, 0.98));
  --artifact-panel-border: rgba(255, 255, 255, 0.08);
  --artifact-panel-shadow: 0 18px 80px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  --artifact-surface: rgba(255, 255, 255, 0.03);
  --artifact-surface-strong: rgba(255, 255, 255, 0.07);
  --artifact-surface-hover: rgba(255, 255, 255, 0.05);
  --artifact-surface-active: rgba(255, 255, 255, 0.07);
  --artifact-border: rgba(255, 255, 255, 0.08);
  --artifact-border-strong: rgba(96, 165, 250, 0.34);
  --artifact-text: #f4f4f5;
  --artifact-muted: rgba(244, 244, 245, 0.58);
  --artifact-faint: rgba(244, 244, 245, 0.42);
  --artifact-chip-active-bg: #fafafa;
  --artifact-chip-active-text: #18181b;
  --artifact-mode-active-bg: rgba(255, 255, 255, 0.12);
  --artifact-mode-active-text: #fafafa;
  --artifact-modal-bg:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.08), transparent 30%),
    linear-gradient(180deg, rgba(34, 34, 35, 0.99), rgba(27, 27, 29, 0.99));
  --artifact-modal-topbar-bg: rgba(32, 32, 34, 0.96);
  --artifact-modal-content-bg: #1f1f21;
  --artifact-doc-bg: #202123;
  --artifact-code-bg: #171719;
  --artifact-code-text: #e4e4e7;
  --artifact-code-border: rgba(255, 255, 255, 0.08);
  --artifact-markdown-code-bg: rgba(255, 255, 255, 0.08);
  --artifact-markdown-block-bg: rgba(255, 255, 255, 0.04);
  --artifact-table-head-bg: rgba(255, 255, 255, 0.08);
  --artifact-table-row-bg: rgba(255, 255, 255, 0.03);
  --artifact-table-row-alt-bg: rgba(255, 255, 255, 0.06);
  --artifact-control-bg: rgba(255, 255, 255, 0.03);
  --artifact-control-hover: rgba(255, 255, 255, 0.08);
  --artifact-control-shadow: none;
  --artifact-danger-bg: rgba(248, 113, 113, 0.1);
  --artifact-danger-border: rgba(248, 113, 113, 0.16);
  --artifact-danger-text: #fecaca;
  --artifact-warning-bg: rgba(250, 204, 21, 0.12);
  --artifact-warning-border: rgba(250, 204, 21, 0.16);
  --artifact-warning-text: #fde68a;
  --artifact-skeleton-a: rgba(255, 255, 255, 0.04);
  --artifact-skeleton-b: rgba(255, 255, 255, 0.09);
}

.artifact-panel {
  border-color: var(--artifact-panel-border);
  background: var(--artifact-panel-bg);
  box-shadow: var(--artifact-panel-shadow);
  color: var(--artifact-text);
}

.artifact-title,
.artifact-file-name,
.artifact-empty-title,
.artifact-modal-filename {
  color: var(--artifact-text);
}

.artifact-subtitle,
.artifact-group-title,
.artifact-file-time,
.artifact-file-tag,
.artifact-empty-text,
.artifact-modal-meta,
.artifact-preview-meta {
  color: var(--artifact-muted);
}

.artifact-close-btn,
.artifact-action-btn,
.artifact-back-btn,
.artifact-filter-chip,
.artifact-modal-icon-btn,
.artifact-modal-close,
.artifact-mode-btn {
  color: var(--artifact-muted);
}

.artifact-action-btn,
.artifact-filter-chip,
.artifact-back-btn,
.artifact-mode-switch {
  border-color: var(--artifact-border);
  background: var(--artifact-control-bg);
}

.artifact-action-btn:hover,
.artifact-close-btn:hover,
.artifact-back-btn:hover,
.artifact-filter-chip:hover,
.artifact-modal-icon-btn:hover,
.artifact-modal-close:hover {
  border-color: var(--artifact-border-strong);
  background: var(--artifact-control-hover);
  color: var(--artifact-text);
}

.artifact-filter-chip-active {
  background: var(--artifact-chip-active-bg);
  color: var(--artifact-chip-active-text);
  border-color: transparent;
}

.artifact-mode-btn-active {
  background: var(--artifact-mode-active-bg);
  color: var(--artifact-mode-active-text);
  box-shadow: var(--artifact-control-shadow);
}

.artifact-file-row {
  background: var(--artifact-surface);
}

.artifact-file-row:hover {
  background: var(--artifact-surface-hover);
  border-color: var(--artifact-border);
}

.artifact-file-row-active {
  background: var(--artifact-surface-active);
  border-color: var(--artifact-border-strong);
}

.artifact-badge-doc {
  background: var(--artifact-control-bg);
  color: var(--artifact-text);
}

.artifact-file-tag,
.artifact-empty-state {
  background: var(--artifact-control-bg);
  border-color: var(--artifact-border);
}

.artifact-inline-error {
  background: var(--artifact-danger-bg);
  border-color: var(--artifact-danger-border);
  color: var(--artifact-danger-text);
}

.artifact-file-skeleton,
.artifact-preview-skeleton {
  background: linear-gradient(
    90deg,
    var(--artifact-skeleton-a),
    var(--artifact-skeleton-b),
    var(--artifact-skeleton-a)
  );
  background-size: 200% 100%;
}

.artifact-preview-modal {
  border-color: var(--artifact-panel-border);
  background: var(--artifact-modal-bg);
  box-shadow: var(--artifact-panel-shadow);
}

.artifact-modal-topbar {
  border-bottom-color: var(--artifact-border);
  background: var(--artifact-modal-topbar-bg);
}

.artifact-modal-content {
  background: var(--artifact-modal-content-bg);
}

.artifact-modal-doc-surface {
  background: var(--artifact-doc-bg);
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview-wrapper),
.artifact-modal-doc-surface :deep(.md-editor-preview),
.artifact-modal-doc-surface :deep(.md-editor-previewOnly),
.artifact-modal-doc-surface :deep(.md-editor-content),
.artifact-modal-doc-surface :deep(.md-editor) {
  --md-color: var(--artifact-text);
  --md-bk-color: transparent;
  --md-bk-color-outstand: transparent;
  --md-border-color: var(--artifact-border);
  background: transparent;
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview h1),
.artifact-modal-doc-surface :deep(.md-editor-preview h2),
.artifact-modal-doc-surface :deep(.md-editor-preview h3),
.artifact-modal-doc-surface :deep(.md-editor-preview h4),
.artifact-modal-doc-surface :deep(.md-editor-preview h5),
.artifact-modal-doc-surface :deep(.md-editor-preview h6),
.artifact-modal-doc-surface :deep(.md-editor-preview p),
.artifact-modal-doc-surface :deep(.md-editor-preview ul),
.artifact-modal-doc-surface :deep(.md-editor-preview ol),
.artifact-modal-doc-surface :deep(.md-editor-preview li),
.artifact-modal-doc-surface :deep(.md-editor-preview strong),
.artifact-modal-doc-surface :deep(.md-editor-preview em),
.artifact-modal-doc-surface :deep(.md-editor-preview table),
.artifact-modal-doc-surface :deep(.md-editor-preview th),
.artifact-modal-doc-surface :deep(.md-editor-preview td) {
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview blockquote),
.artifact-modal-doc-surface :deep(.md-editor-preview pre) {
  border-color: var(--artifact-border);
  background: var(--artifact-markdown-block-bg);
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview code) {
  background: var(--artifact-markdown-code-bg);
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview a) {
  color: #2563eb;
}

:global(html.dark) .artifact-modal-doc-surface :deep(.md-editor-preview a),
:global(html[data-theme='dark']) .artifact-modal-doc-surface :deep(.md-editor-preview a) {
  color: #93c5fd;
}

.artifact-modal-doc-surface :deep(.md-editor-preview hr),
.artifact-modal-doc-surface :deep(.md-editor-preview table),
.artifact-modal-doc-surface :deep(.md-editor-preview th),
.artifact-modal-doc-surface :deep(.md-editor-preview td) {
  border-color: var(--artifact-border);
}

.artifact-modal-doc-surface :deep(.md-editor-preview ul) {
  list-style: disc;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ol) {
  list-style: decimal;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ul),
.artifact-modal-doc-surface :deep(.md-editor-preview ol) {
  margin: 1em 0;
  padding-left: 2.35em;
}

.artifact-modal-doc-surface :deep(.md-editor-preview li) {
  display: list-item;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ul ul) {
  list-style: circle;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ul ul ul) {
  list-style: square;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ol ol) {
  list-style: lower-alpha;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ol ol ol) {
  list-style: lower-roman;
}

.artifact-modal-doc-surface :deep(.md-editor-preview table) {
  display: block;
  width: max-content;
  min-width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  background: transparent;
}

.artifact-modal-doc-surface :deep(.md-editor-preview thead) {
  background: var(--artifact-table-head-bg);
}

.artifact-modal-doc-surface :deep(.md-editor-preview tbody tr) {
  background: var(--artifact-table-row-bg);
}

.artifact-modal-doc-surface :deep(.md-editor-preview tbody tr:nth-child(2n)) {
  background: var(--artifact-table-row-alt-bg);
}

.artifact-modal-doc-surface :deep(.md-editor-preview th),
.artifact-modal-doc-surface :deep(.md-editor-preview td) {
  background: transparent;
}

.artifact-modal-code-surface,
.artifact-code-surface {
  border: 1px solid var(--artifact-code-border);
  background: var(--artifact-code-bg);
  color: var(--artifact-code-text);
}

.artifact-warning-box {
  background: var(--artifact-warning-bg);
  border-color: var(--artifact-warning-border);
  color: var(--artifact-warning-text);
}

.artifact-preview-slide-enter-active,
.artifact-preview-slide-leave-active,
.artifact-backdrop-enter-active,
.artifact-backdrop-leave-active {
  transition: all 180ms ease;
}

.artifact-preview-slide-enter-from,
.artifact-preview-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.artifact-backdrop-enter-from,
.artifact-backdrop-leave-to {
  opacity: 0;
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
  .artifact-panel {
    width: 100%;
    height: 100%;
    border-radius: 24px;
  }

  .artifact-list-condensed {
    padding-right: 28px;
  }

  .artifact-preview-panel {
    width: 100%;
    border-left: none;
  }

  .artifact-preview-modal {
    inset: 10px;
    border-radius: 18px;
  }

  .artifact-modal-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .artifact-modal-toolbar {
    width: 100%;
    justify-content: space-between;
  }

  .artifact-modal-doc-surface {
    padding: 24px;
  }
}
</style>
