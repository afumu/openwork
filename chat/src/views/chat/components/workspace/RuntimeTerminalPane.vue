<script setup lang="ts">
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { toTerminalLines } from './ideWorkspace'
import type { ToolExecutionLike } from './ideWorkspace'

interface ToolExecutionRecord extends ToolExecutionLike {
  event?: string
  id?: string
  is_error?: boolean
  tool_call_id?: string
  type?: string
}

const props = defineProps<{
  chats: Chat.Chat[]
  isStreaming: boolean
}>()

const terminalEl = ref<HTMLDivElement | null>(null)
let terminal: Terminal | null = null

const records = computed<ToolExecutionRecord[]>(() => {
  return props.chats.flatMap(chat => [
    ...parseJsonRecords(chat.tool_execution),
    ...parseJsonRecords(chat.stream_segments).filter(record => record?.type === 'tool_execution'),
  ])
})

const terminalLines = computed(() => toTerminalLines(records.value))

function parseJsonRecords(value?: string | null): ToolExecutionRecord[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (_error) {
    return []
  }
}

function createTerminal() {
  if (!terminalEl.value) return

  terminal?.dispose()
  terminal = new Terminal({
    allowProposedApi: false,
    cols: 120,
    convertEol: true,
    cursorBlink: props.isStreaming,
    disableStdin: true,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.45,
    rows: 16,
    theme: {
      background: '#050505',
      black: '#151515',
      blue: '#3b82f6',
      brightBlack: '#737373',
      brightBlue: '#60a5fa',
      brightCyan: '#22d3ee',
      brightGreen: '#4ade80',
      brightMagenta: '#c084fc',
      brightRed: '#fb7185',
      brightWhite: '#fafafa',
      brightYellow: '#facc15',
      cursor: '#a3a3a3',
      cyan: '#06b6d4',
      foreground: '#d4d4d8',
      green: '#22c55e',
      magenta: '#a855f7',
      red: '#ef4444',
      selectionBackground: '#404040',
      white: '#e5e5e5',
      yellow: '#eab308',
    },
  })
  terminal.open(terminalEl.value)
  renderTerminal()
}

function renderTerminal() {
  if (!terminal) return

  terminal.options.cursorBlink = props.isStreaming
  terminal.clear()

  if (!terminalLines.value.length) {
    terminal.writeln('\x1b[90m当前对话还没有容器执行记录\x1b[0m')
    terminal.write('\r\n\x1b[32mroot@localhost\x1b[0m:\x1b[36m/workspace/projects\x1b[0m# ')
    return
  }

  terminalLines.value.forEach(line => {
    terminal?.writeln(colorizeTerminalLine(line))
  })

  if (props.isStreaming) {
    terminal.write('\r\n\x1b[32mroot@localhost\x1b[0m:\x1b[36m/workspace/projects\x1b[0m# ')
  }
}

function colorizeTerminalLine(line: string) {
  if (line.includes(' error') || line.includes('failed')) {
    return `\x1b[31m${line}\x1b[0m`
  }
  if (line.includes(' completed')) {
    return `\x1b[32m${line}\x1b[0m`
  }
  if (line.includes(' executing')) {
    return `\x1b[36m${line}\x1b[0m`
  }
  return line
}

function clearTerminal() {
  terminal?.clear()
  terminal?.write('\x1b[32mroot@localhost\x1b[0m:\x1b[36m/workspace/projects\x1b[0m# ')
}

watch(
  () => [terminalLines.value.join('\n'), props.isStreaming] as const,
  () => {
    void nextTick(renderTerminal)
  }
)

onMounted(() => {
  createTerminal()
})

onBeforeUnmount(() => {
  terminal?.dispose()
  terminal = null
})
</script>

<template>
  <section class="runtime-terminal-pane flex h-full min-h-0 flex-col bg-[#050505] text-zinc-100">
    <header
      class="flex h-10 shrink-0 items-center justify-between border-t border-[#2a2a2a] border-b border-[#242424] bg-[#070707] px-4 text-xs"
    >
      <div class="flex h-full items-center gap-7">
        <button class="terminal-tab terminal-tab-active" type="button">终端</button>
        <button class="terminal-tab" type="button">控制台</button>
        <button class="terminal-tab" type="button">输出</button>
      </div>
      <div class="flex items-center gap-3 text-zinc-400">
        <span>{{ isStreaming ? '执行中' : '空闲' }}</span>
        <button class="terminal-action" type="button" @click="clearTerminal">清理</button>
        <button class="terminal-icon" type="button" title="新终端">＋</button>
        <button class="terminal-icon" type="button" title="聚焦">⛶</button>
      </div>
    </header>

    <div ref="terminalEl" class="min-h-0 flex-1 overflow-hidden px-3 py-2" />
  </section>
</template>

<style scoped>
.terminal-tab {
  display: inline-flex;
  height: 100%;
  align-items: center;
  border-bottom: 2px solid transparent;
  color: #a1a1aa;
  font-size: 13px;
  font-weight: 500;
}

.terminal-tab-active {
  border-color: #e5e5e5;
  color: #f4f4f5;
}

.terminal-action {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px;
  padding: 3px 9px;
  color: #d4d4d8;
}

.terminal-action:hover,
.terminal-icon:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.terminal-icon {
  display: inline-flex;
  height: 26px;
  width: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #d4d4d8;
  font-size: 16px;
}

.runtime-terminal-pane :deep(.xterm) {
  height: 100%;
}

.runtime-terminal-pane :deep(.xterm-viewport),
.runtime-terminal-pane :deep(.xterm-screen) {
  width: 100% !important;
}
</style>
