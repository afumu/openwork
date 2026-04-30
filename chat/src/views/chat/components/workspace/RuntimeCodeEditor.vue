<script setup lang="ts">
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveCodeLanguage, resolveIdeTabTitle } from './ideWorkspace'
import type { RuntimeWorkspaceEditorTab } from './useRuntimeWorkspaceTabs'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

const props = defineProps<{
  activePath: string
  modelValue: string
  readonly?: boolean
  saving?: boolean
  tabs: RuntimeWorkspaceEditorTab[]
}>()

const emit = defineEmits<{
  (event: 'close-tab', path: string): void
  (event: 'keep-conflict', path: string): void
  (event: 'reload-conflict', path: string): void
  (event: 'save'): void
  (event: 'select-tab', path: string): void
  (event: 'update:modelValue', value: string): void
}>()

const editorEl = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let resizeObserver: ResizeObserver | null = null

const activeTab = computed(() => props.tabs.find(tab => tab.path === props.activePath) || null)
const language = computed(() =>
  resolveCodeLanguage(activeTab.value?.path || '', activeTab.value?.file.type || '')
)

function toMonacoLanguage(value: string) {
  if (value === 'vue') return 'html'
  if (value === 'yaml') return 'yaml'
  return value
}

async function mountEditor() {
  await nextTick()
  if (!editorEl.value || editor) return

  editor = monaco.editor.create(editorEl.value, {
    automaticLayout: true,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    glyphMargin: false,
    language: toMonacoLanguage(language.value),
    minimap: { enabled: false },
    model: null,
    readOnly: props.readonly,
    scrollBeyondLastLine: false,
    tabSize: 2,
    theme: 'vs',
    wordWrap: 'on',
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  editor.onDidChangeModelContent(() => {
    const value = editor?.getValue() || ''
    if (value !== props.modelValue) emit('update:modelValue', value)
  })

  resizeObserver = new ResizeObserver(() => editor?.layout())
  resizeObserver.observe(editorEl.value)
  syncModel()
}

function syncModel() {
  if (!editor) return

  if (!activeTab.value) {
    editor.setModel(null)
    return
  }

  const uri = monaco.Uri.parse(`runtime://workspace/${activeTab.value.path}`)
  let model = monaco.editor.getModel(uri)
  if (!model) {
    model = monaco.editor.createModel(
      props.modelValue,
      toMonacoLanguage(language.value),
      uri
    )
  } else if (model.getValue() !== props.modelValue) {
    model.setValue(props.modelValue)
  }

  monaco.editor.setModelLanguage(model, toMonacoLanguage(language.value))
  if (editor.getModel() !== model) editor.setModel(model)
  editor.updateOptions({ readOnly: props.readonly })
}

watch(
  () => [props.activePath, props.modelValue, language.value, props.readonly] as const,
  () => syncModel(),
  { flush: 'post' }
)

onMounted(() => {
  void mountEditor()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  editor?.dispose()
  editor = null
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-white">
    <div v-if="tabs.length" class="editor-tabs custom-scrollbar flex h-10 shrink-0 overflow-x-auto border-b border-zinc-200 bg-zinc-50">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        class="editor-tab"
        :class="{ 'editor-tab-active': tab.path === activePath, 'editor-tab-conflict': tab.conflict }"
        type="button"
        @click="emit('select-tab', tab.path)"
      >
        <span v-if="tab.dirty" class="dirty-dot" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ resolveIdeTabTitle(tab.file) }}</span>
        <span v-if="tab.conflict" class="conflict-label">冲突</span>
        <span v-else-if="tab.saving" class="conflict-label">保存中</span>
        <span class="tab-close" @click.stop="emit('close-tab', tab.path)">×</span>
      </button>
    </div>

    <div
      v-if="activeTab?.conflict"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
    >
      <span class="min-w-0 truncate">文件已在工作区中更新。可以重新加载远端内容，或保留当前未保存修改。</span>
      <span class="flex shrink-0 items-center gap-2">
        <button class="conflict-action" type="button" @click="emit('reload-conflict', activeTab.path)">重新加载</button>
        <button class="conflict-action" type="button" @click="emit('keep-conflict', activeTab.path)">保留本地</button>
      </span>
    </div>

    <div
      v-if="!activeTab"
      class="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-500"
    >
      <div>
        <div
          class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-xl text-zinc-700"
        >
          &lt;/&gt;
        </div>
        <div class="text-lg font-semibold text-zinc-900">代码编辑器</div>
        <div class="mt-2 text-zinc-500">请在左侧文件导航中打开任意文件</div>
      </div>
    </div>

    <div v-show="activeTab" ref="editorEl" class="monaco-editor-host min-h-0 flex-1 overflow-hidden" />
  </section>
</template>

<style scoped>
.editor-tab {
  display: inline-flex;
  max-width: 220px;
  min-width: 120px;
  align-items: center;
  gap: 7px;
  border-right: 1px solid #e4e4e7;
  padding: 0 9px 0 12px;
  color: #52525b;
  font-size: 13px;
  white-space: nowrap;
}

.editor-tab:hover {
  background: #f4f4f5;
  color: #18181b;
}

.editor-tab-active {
  background: #ffffff;
  color: #18181b;
}

.editor-tab-conflict {
  color: #92400e;
}

.dirty-dot {
  height: 7px;
  width: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #2563eb;
}

.conflict-label {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #fef3c7;
  padding: 1px 6px;
  color: #92400e;
  font-size: 11px;
}

.tab-close {
  display: inline-flex;
  height: 20px;
  width: 20px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #71717a;
  font-size: 16px;
}

.tab-close:hover,
.conflict-action:hover {
  background: #e4e4e7;
  color: #18181b;
}

.conflict-action {
  border-radius: 7px;
  background: #fff7ed;
  padding: 3px 8px;
  color: #92400e;
  font-weight: 600;
}

.monaco-editor-host :deep(.monaco-editor),
.monaco-editor-host :deep(.overflow-guard) {
  height: 100%;
}
</style>
