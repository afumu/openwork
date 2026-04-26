<script setup lang="ts">
import { useAuthStore } from '@/store/modules/auth'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseRuntimeTerminalServerMessage, buildRuntimeTerminalWsUrl } from './runtimeTerminal'
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
  groupId: number
  isStreaming: boolean
}>()

const terminalEl = ref<HTMLDivElement | null>(null)
const currentContainerName = ref('')
const currentCwd = ref('')
const terminalStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
let terminal: Terminal | null = null
let terminalSocket: WebSocket | null = null

const records = computed<ToolExecutionRecord[]>(() => {
  return props.chats.flatMap(chat => [
    ...parseJsonRecords(chat.tool_execution),
    ...parseJsonRecords(chat.stream_segments).filter(record => record?.type === 'tool_execution'),
  ])
})

const terminalLines = computed(() => toTerminalLines(records.value))
const authStore = useAuthStore()
const statusLabel = computed(() => {
  if (terminalStatus.value === 'connecting') return '连接容器中'
  if (terminalStatus.value === 'connected') return props.isStreaming ? '任务执行中' : '已连接'
  if (terminalStatus.value === 'error') return '连接失败'
  return '未连接'
})

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
    disableStdin: false,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.45,
    rows: 16,
    theme: {
      background: '#ffffff',
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
      cursor: '#3f3f46',
      cyan: '#06b6d4',
      foreground: '#27272a',
      green: '#22c55e',
      magenta: '#a855f7',
      red: '#ef4444',
      selectionBackground: '#d4d4d8',
      white: '#e5e5e5',
      yellow: '#eab308',
    },
  })
  terminal.open(terminalEl.value)
  terminal.onData(handleTerminalData)
  terminal.onResize(size => {
    sendTerminalMessage({
      cols: size.cols,
      rows: size.rows,
      type: 'resize',
    })
  })
  renderInitialTerminal()
}

function renderInitialTerminal() {
  if (!terminal) return

  terminal.options.cursorBlink = props.isStreaming
  terminal.clear()

  if (!terminalLines.value.length) {
    terminal.writeln('\x1b[90m当前对话还没有容器执行记录\x1b[0m')
  } else {
    terminalLines.value.forEach(line => {
      terminal?.writeln(colorizeTerminalLine(line))
    })
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
}

function startNewTerminal() {
  renderInitialTerminal()
  connectTerminal()
}

function handleTerminalData(data: string) {
  sendTerminalMessage({
    data,
    type: 'input',
  })
}

function sendTerminalMessage(payload: Record<string, any>) {
  if (terminalSocket?.readyState === WebSocket.OPEN) {
    terminalSocket.send(JSON.stringify(payload))
  }
}

function disconnectTerminal() {
  terminalSocket?.close()
  terminalSocket = null
  terminalStatus.value = 'disconnected'
}

function connectTerminal() {
  disconnectTerminal()
  if (!terminal || !props.groupId) return

  const token = authStore.token
  if (!token) {
    terminal.writeln('\x1b[31m请先登录后再打开终端\x1b[0m')
    terminalStatus.value = 'error'
    return
  }

  terminalStatus.value = 'connecting'
  terminal.writeln('\x1b[90m正在连接容器终端...\x1b[0m')

  const socket = new WebSocket(
    buildRuntimeTerminalWsUrl({
      apiBaseUrl: import.meta.env.VITE_GLOB_API_URL,
      cols: terminal.cols,
      groupId: props.groupId,
      rows: terminal.rows,
      token,
      windowLocation: window.location,
    })
  )
  terminalSocket = socket

  socket.addEventListener('open', () => {
    terminalStatus.value = 'connected'
  })

  socket.addEventListener('message', event => {
    const message = parseRuntimeTerminalServerMessage(String(event.data))
    if (!message) return

    if (message.type === 'ready') {
      currentContainerName.value = message.containerName || ''
      currentCwd.value = message.cwd || ''
      terminalStatus.value = 'connected'
      return
    }

    if (message.type === 'output') {
      terminal?.write(message.data)
      return
    }

    if (message.type === 'error') {
      terminalStatus.value = 'error'
      terminal?.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`)
      return
    }

    if (message.type === 'exit') {
      terminalStatus.value = 'disconnected'
      terminal?.writeln(`\r\n\x1b[90m终端已退出${message.code ? ` (${message.code})` : ''}\x1b[0m`)
    }
  })

  socket.addEventListener('close', () => {
    if (terminalSocket === socket) {
      terminalSocket = null
      if (terminalStatus.value !== 'error') terminalStatus.value = 'disconnected'
    }
  })

  socket.addEventListener('error', () => {
    terminalStatus.value = 'error'
    terminal?.writeln('\r\n\x1b[31m终端连接失败\x1b[0m')
  })
}

watch(
  () => [terminalLines.value.join('\n'), props.isStreaming] as const,
  () => {
    terminal && (terminal.options.cursorBlink = props.isStreaming)
  }
)

watch(
  () => props.groupId,
  () => {
    currentContainerName.value = ''
    currentCwd.value = ''
    void nextTick(() => {
      renderInitialTerminal()
      connectTerminal()
    })
  }
)

onMounted(() => {
  createTerminal()
  connectTerminal()
})

onBeforeUnmount(() => {
  disconnectTerminal()
  terminal?.dispose()
  terminal = null
})
</script>

<template>
  <section class="runtime-terminal-pane flex h-full min-h-0 flex-col bg-white text-zinc-900">
    <header
      class="flex h-10 shrink-0 items-center justify-between border-t border-zinc-200 border-b border-zinc-200 bg-zinc-50 px-4 text-xs"
    >
      <div class="flex h-full items-center gap-7">
        <button class="terminal-tab terminal-tab-active" type="button">终端</button>
        <button class="terminal-tab" type="button">控制台</button>
        <button class="terminal-tab" type="button">输出</button>
      </div>
      <div class="flex items-center gap-3 text-zinc-500">
        <span v-if="currentContainerName" class="max-w-[220px] truncate">
          容器 {{ currentContainerName }}
        </span>
        <span>{{ statusLabel }}</span>
        <button class="terminal-action" type="button" @click="clearTerminal">清理</button>
        <button class="terminal-icon" type="button" title="新终端" @click="startNewTerminal">＋</button>
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
  color: #71717a;
  font-size: 13px;
  font-weight: 500;
}

.terminal-tab-active {
  border-color: #27272a;
  color: #18181b;
}

.terminal-action {
  border: 1px solid #d4d4d8;
  border-radius: 7px;
  padding: 3px 9px;
  color: #3f3f46;
}

.terminal-action:hover,
.terminal-icon:hover {
  background: #f4f4f5;
  color: #18181b;
}

.terminal-icon {
  display: inline-flex;
  height: 26px;
  width: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #3f3f46;
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
