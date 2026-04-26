<script setup lang="ts">
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { EditorView, basicSetup } from 'codemirror'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveCodeLanguage } from './ideWorkspace'
import type { ArtifactReadResult } from './types'

const props = defineProps<{
  file: ArtifactReadResult | null
  readonly?: boolean
}>()

const editorEl = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

const code = computed(() => props.file?.content || '')
const language = computed(() => resolveCodeLanguage(props.file?.path || '', props.file?.type || ''))

function languageExtension() {
  switch (language.value) {
    case 'css':
      return css()
    case 'html':
    case 'vue':
    case 'xml':
      return html()
    case 'javascript':
      return javascript()
    case 'typescript':
      return javascript({ typescript: true })
    case 'json':
      return json()
    case 'markdown':
      return markdown()
    case 'python':
      return python()
    case 'rust':
      return rust()
    case 'sql':
      return sql()
    default:
      return []
  }
}

function mountEditor() {
  if (!editorEl.value) return
  view?.destroy()
  view = new EditorView({
    doc: code.value,
    extensions: [
      basicSetup,
      languageExtension(),
      EditorView.editable.of(!props.readonly),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          backgroundColor: '#ffffff',
          color: '#27272a',
          height: '100%',
          fontSize: '13px',
        },
        '.cm-content': {
          caretColor: '#2563eb',
        },
        '.cm-gutters': {
          backgroundColor: '#f8fafc',
          borderRight: '1px solid #e4e4e7',
          color: '#71717a',
        },
        '.cm-activeLine, .cm-activeLineGutter': {
          backgroundColor: '#f4f4f5',
        },
        '.cm-scroller': {
          fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
      }),
    ],
    parent: editorEl.value,
  })
}

watch(
  () => [props.file?.path, props.file?.content, props.readonly] as const,
  () => mountEditor()
)

onMounted(() => mountEditor())

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-white">
    <div
      v-if="!file"
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

    <div v-else ref="editorEl" class="min-h-0 flex-1 overflow-hidden" />
  </section>
</template>
