<script setup lang="ts">
import { computed } from 'vue'

interface ToolExecutionRecord {
  id?: string
  tool_call_id?: string
  tool_name?: string
  event?: string
  phase?: string
  kind?: string
  step?: string
  step_title?: string
  display_title?: string
  display_subtitle?: string
  target?: string
  args_preview?: string
  is_error?: boolean
  result_preview?: string
  type?: string
}

const props = defineProps<{
  chats: Chat.Chat[]
  isStreaming: boolean
}>()

const logRows = computed(() => {
  return props.chats.flatMap((chat, chatIndex) => {
    return [...parseToolExecutions(chat), ...parseStreamToolExecutions(chat)].map(
      (record, index) => ({
        ...record,
        rowId: `${chat.chatId || chatIndex}-${record.tool_call_id || record.id || index}`,
      })
    )
  })
})

function parseToolExecutions(chat: Chat.Chat): ToolExecutionRecord[] {
  if (!chat.tool_execution) return []
  try {
    const parsed = JSON.parse(chat.tool_execution)
    return Array.isArray(parsed) ? parsed : []
  } catch (_error) {
    return []
  }
}

function parseStreamToolExecutions(chat: Chat.Chat): ToolExecutionRecord[] {
  if (!chat.stream_segments) return []
  try {
    const parsed = JSON.parse(chat.stream_segments)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(segment => segment?.type === 'tool_execution')
  } catch (_error) {
    return []
  }
}

function resolveTitle(row: ToolExecutionRecord) {
  return row.display_title || row.step_title || row.tool_name || row.step || 'tool'
}

function resolveDetail(row: ToolExecutionRecord) {
  return row.args_preview || row.target || row.display_subtitle || ''
}

function resolveStatusLabel(row: ToolExecutionRecord) {
  if (row.is_error) return 'error'
  return row.phase || row.event || 'event'
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-[#0b1220] text-slate-100">
    <header
      class="flex min-h-[46px] items-center justify-between border-b border-white/10 px-4 text-xs"
    >
      <span class="font-semibold">PI tool execution</span>
      <span
        class="rounded-full px-2 py-1"
        :class="isStreaming ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-slate-300'"
      >
        {{ isStreaming ? 'streaming' : 'idle' }}
      </span>
    </header>

    <div
      v-if="!logRows.length"
      class="flex flex-1 items-center justify-center px-6 text-sm text-slate-400"
    >
      当前对话还没有容器执行记录
    </div>

    <div v-else class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
      <div
        v-for="row in logRows"
        :key="row.rowId"
        class="mb-2 rounded-lg border border-white/10 bg-white/[0.03] p-3"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 truncate font-semibold">
            <span :class="row.is_error ? 'text-rose-300' : 'text-emerald-300'">
              {{ row.is_error ? '×' : '›' }}
            </span>
            {{ resolveTitle(row) }}
          </div>
          <span class="shrink-0 text-[11px] text-slate-400">{{ resolveStatusLabel(row) }}</span>
        </div>
        <div v-if="resolveDetail(row)" class="mt-2 break-words text-slate-300">
          {{ resolveDetail(row) }}
        </div>
        <div v-if="row.result_preview" class="mt-2 break-words text-slate-400">
          {{ row.result_preview }}
        </div>
      </div>
    </div>
  </section>
</template>
