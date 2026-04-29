<script setup lang="ts">
import { useAppStore } from '@/store'
import { getArtifactMarkdownTheme } from '@/utils/artifactPreview'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { resolvePreviewKind } from './artifactWorkspace'
import type { ArtifactReadResult } from './types'

const props = defineProps<{
  appPreviewPort?: number
  appPreviewReloadKey?: number | string
  appPreviewRunning?: boolean
  appPreviewUrl?: string
  file: ArtifactReadResult | null
}>()

const appStore = useAppStore()

const isDarkTheme = computed(() => {
  if (appStore.theme === 'dark') return true
  if (typeof document === 'undefined') return false
  const html = document.documentElement
  return html.classList.contains('dark') || html.dataset.theme === 'dark'
})

const markdownPreviewTheme = computed(() => getArtifactMarkdownTheme(isDarkTheme.value))
const previewFrameNonce = ref(0)
const previewReloadTimers: number[] = []

const previewKind = computed(() => {
  if (props.appPreviewUrl) return 'app'
  if (!props.file) return 'empty'
  return resolvePreviewKind(props.file.path, props.file.type)
})

const formattedContent = computed(() => {
  if (!props.file) return ''
  if (props.file.type !== 'json' && !props.file.path.endsWith('.json')) return props.file.content

  try {
    return JSON.stringify(JSON.parse(props.file.content), null, 2)
  } catch (_error) {
    return props.file.content
  }
})

const imageSource = computed(() => {
  if (!props.file) return ''
  if (props.file.content.startsWith('data:')) return props.file.content
  return `data:${props.file.type || 'image/*'};base64,${props.file.content}`
})

const previewFrameKey = computed(() =>
  [props.appPreviewUrl || '', props.appPreviewRunning ? 'running' : 'idle', previewFrameNonce.value].join(':')
)

function clearPreviewReloadTimers() {
  while (previewReloadTimers.length) {
    const timer = previewReloadTimers.pop()
    if (timer) window.clearTimeout(timer)
  }
}

function schedulePreviewReload() {
  clearPreviewReloadTimers()
  if (!props.appPreviewUrl) return

  previewFrameNonce.value += 1
  if (!props.appPreviewRunning) return

  for (const delay of [1200, 3500]) {
    previewReloadTimers.push(
      window.setTimeout(() => {
        previewFrameNonce.value += 1
      }, delay)
    )
  }
}

watch(
  () => [props.appPreviewUrl, props.appPreviewRunning, props.appPreviewReloadKey] as const,
  schedulePreviewReload,
  { immediate: true }
)

onBeforeUnmount(() => {
  clearPreviewReloadTimers()
})
</script>

<template>
  <section
    class="runtime-preview-pane flex h-full min-h-0 flex-col overflow-hidden bg-white text-zinc-900"
  >
    <template v-if="appPreviewUrl">
      <header
        class="flex min-h-[46px] items-center justify-between gap-3 border-b border-zinc-200 px-4"
      >
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-zinc-900">应用预览</div>
          <div class="truncate text-xs text-zinc-500">
            {{ appPreviewRunning ? '运行中' : '等待服务启动' }}
            <span v-if="appPreviewPort"> · {{ appPreviewPort }}</span>
          </div>
        </div>
        <a
          class="shrink-0 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
          :href="appPreviewUrl"
          target="_blank"
          rel="noopener"
        >
          打开
        </a>
      </header>

      <iframe
        :key="previewFrameKey"
        class="block min-h-0 flex-1 border-0 bg-white"
        :src="appPreviewUrl"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      />
    </template>

    <div
      v-else-if="!file"
      class="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-500"
    >
      <div>
        <div
          class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-xl text-zinc-700"
        >
          ◫
        </div>
        <div class="text-lg font-semibold text-zinc-900">预览</div>
        <div class="mt-2 text-zinc-500">请在左侧文件导航中打开任意文件</div>
      </div>
    </div>

    <template v-else>
      <header
        class="flex min-h-[46px] items-center justify-between gap-3 border-b border-zinc-200 px-4"
      >
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-zinc-900">
            {{ file.path.split('/').pop() || file.path }}
          </div>
          <div class="truncate text-xs text-zinc-500">{{ file.path }}</div>
        </div>
        <span
          v-if="file.truncated"
          class="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
        >
          已截断
        </span>
      </header>

      <main class="custom-scrollbar min-h-0 flex-1 overflow-auto bg-white">
        <MdPreview
          v-if="previewKind === 'markdown'"
          editor-id="runtime-workspace-markdown-preview"
          class="runtime-markdown-preview min-h-full bg-white px-7 py-6"
          :model-value="file.content"
          :theme="markdownPreviewTheme"
          preview-theme="github"
        />

        <iframe
          v-else-if="previewKind === 'html'"
          class="block h-full min-h-[520px] w-full border-0 bg-white"
          :srcdoc="file.content"
          sandbox="allow-scripts allow-same-origin"
        />

        <div
          v-else-if="previewKind === 'image'"
          class="flex min-h-full items-center justify-center p-6"
        >
          <img
            class="max-h-full max-w-full rounded-lg border border-gray-200 bg-white object-contain dark:border-gray-700"
            :src="imageSource"
            :alt="file.path"
          />
        </div>

        <pre
          v-else
          class="min-h-full whitespace-pre-wrap break-words p-5 text-xs leading-6 text-zinc-800"
        ><code>{{ formattedContent }}</code></pre>
      </main>
    </template>
  </section>
</template>

<style scoped>
.runtime-preview-pane :deep(.md-editor-preview-wrapper),
.runtime-preview-pane :deep(.md-editor-preview),
.runtime-preview-pane :deep(.md-editor-previewOnly),
.runtime-preview-pane :deep(.md-editor-content),
.runtime-preview-pane :deep(.md-editor) {
  background: transparent;
}

.runtime-preview-pane :deep(.md-editor-preview ul) {
  list-style: disc;
}

.runtime-preview-pane :deep(.md-editor-preview ol) {
  list-style: decimal;
}

.runtime-preview-pane :deep(.md-editor-preview ul),
.runtime-preview-pane :deep(.md-editor-preview ol) {
  margin: 1em 0;
  padding-left: 2.35em;
}

.runtime-preview-pane :deep(.md-editor-preview li) {
  display: list-item;
}
</style>
