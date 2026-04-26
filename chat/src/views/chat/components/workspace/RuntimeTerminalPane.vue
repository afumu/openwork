<script setup lang="ts">
import { executeRuntimeCommandAPI } from '@/api/runtime'
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
  groupId: number
  isStreaming: boolean
}>()

const terminalEl = ref<HTMLDivElement | null>(null)
const commandOutputLines = ref<string[]>([])
const currentInput = ref('')
const commandRunning = ref(false)
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
  renderTerminal()
}

function renderTerminal() {
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

  commandOutputLines.value.forEach(line => {
    terminal?.writeln(line)
  })

  writePrompt()
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
  commandOutputLines.value = []
  currentInput.value = ''
  renderTerminal()
}

function writePrompt() {
  terminal?.write('\r\n\x1b[32mroot@localhost\x1b[0m:\x1b[36m/workspace/projects\x1b[0m# ')
  if (currentInput.value) terminal?.write(currentInput.value)
}

function handleTerminalData(data: string) {
  if (!terminal || commandRunning.value) return

  if (data === '\r') {
    void submitCommand()
    return
  }

  if (data === '\u0003') {
    currentInput.value = ''
    terminal.write('^C')
    writePrompt()
    return
  }

  if (data === '\u007f') {
    if (!currentInput.value) return
    currentInput.value = currentInput.value.slice(0, -1)
    terminal.write('\b \b')
    return
  }

  if (/^[\x20-\x7E]$/.test(data)) {
    currentInput.value += data
    terminal.write(data)
  }
}

async function submitCommand() {
  if (!terminal) return

  const command = currentInput.value.trim()
  currentInput.value = ''
  terminal.writeln('')

  if (!command) {
    writePrompt()
    return
  }

  if (!props.groupId) {
    terminal.writeln('\x1b[31m当前没有可执行的对话工作区\x1b[0m')
    writePrompt()
    return
  }

  commandRunning.value = true
  commandOutputLines.value.push(
    `\x1b[32mroot@localhost\x1b[0m:\x1b[36m/workspace/projects\x1b[0m# ${command}`
  )

  try {
    const res: any = await executeRuntimeCommandAPI({ groupId: props.groupId, command })
    const result = unwrapCommandResult(res)
    if (!result) throw new Error('终端命令返回格式不正确')

    writeCommandOutput(result.stdout)
    writeCommandOutput(result.stderr, true)
    if (result.code !== 0) terminal.writeln(`\x1b[31mexit ${result.code}\x1b[0m`)

    commandOutputLines.value.push(...formatCommandResultLines(result))
  } catch (error: any) {
    const message = error?.message || '终端命令执行失败'
    terminal.writeln(`\x1b[31m${message}\x1b[0m`)
    commandOutputLines.value.push(`\x1b[31m${message}\x1b[0m`)
  } finally {
    commandRunning.value = false
    writePrompt()
  }
}

function unwrapCommandResult(payload: any): any | null {
  if (!payload || typeof payload !== 'object') return null
  if ('stdout' in payload || 'stderr' in payload || 'code' in payload) return payload
  if ('data' in payload) return unwrapCommandResult(payload.data)
  return null
}

function writeCommandOutput(value?: string, isError = false) {
  if (!value) return
  value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean)
    .forEach(line => {
      terminal?.writeln(isError ? `\x1b[31m${line}\x1b[0m` : line)
    })
}

function formatCommandResultLines(result: any) {
  const lines: string[] = []
  if (result.stdout) lines.push(...result.stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean))
  if (result.stderr) {
    lines.push(
      ...result.stderr
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter(Boolean)
        .map((line: string) => `\x1b[31m${line}\x1b[0m`)
    )
  }
  if (result.code !== 0) lines.push(`\x1b[31mexit ${result.code}\x1b[0m`)
  return lines
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
        <span>{{ commandRunning ? '执行命令中' : isStreaming ? '任务执行中' : '空闲' }}</span>
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
