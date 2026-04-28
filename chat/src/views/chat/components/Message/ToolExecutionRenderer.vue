<script lang="ts" setup>
import { computed, ref } from 'vue'
import {
  extractFilePath,
  extractPlanItems,
  extractTextResult,
  extractTodos,
  extractToolValueFields,
  extractWriteContent,
  getToolExecutionDisplayModel,
  stringifyToolValue,
  type ToolExecutionItem,
} from './toolExecution'

const props = defineProps<{
  item: ToolExecutionItem
}>()

function shouldStartExpanded(item: ToolExecutionItem) {
  const initialModel = getToolExecutionDisplayModel(item)
  return (
    initialModel.status === 'pending' ||
    initialModel.toolName === 'Edit' ||
    initialModel.toolName === 'Write' ||
    initialModel.toolName === 'TodoWrite' ||
    initialModel.toolName === 'UpdatePlan'
  )
}

const expanded = ref(shouldStartExpanded(props.item))

const model = computed(() => getToolExecutionDisplayModel(props.item))
const filePath = computed(() => extractFilePath(model.value.input, model.value.result))
const textResult = computed(() => extractTextResult(model.value.result))
const command = computed(() => {
  const input = model.value.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const record = input as Record<string, unknown>
  return typeof record.command === 'string'
    ? record.command
    : typeof record.cmd === 'string'
      ? record.cmd
      : ''
})
const planItems = computed(() => extractPlanItems(model.value.input))
const todoItems = computed(() => extractTodos(model.value.input, model.value.result))
const writeContent = computed(() => {
  return extractWriteContent(model.value.input)
})
const editBefore = computed(() => {
  const input = model.value.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const value = (input as Record<string, unknown>).old_string
  return typeof value === 'string' ? value : ''
})
const editAfter = computed(() => {
  const input = model.value.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const value = (input as Record<string, unknown>).new_string
  return typeof value === 'string' ? value : ''
})
const inputPreview = computed(() => stringifyToolValue(model.value.input))
const inputFields = computed(() => extractToolValueFields(model.value.input))
const resultFields = computed(() => extractToolValueFields(model.value.result))
const hasDetail = computed(() => {
  if (model.value.toolName === 'UpdatePlan') return planItems.value.length > 0
  if (model.value.toolName === 'TodoWrite') return todoItems.value.length > 0
  return Boolean(
    command.value ||
      filePath.value ||
      textResult.value ||
      inputFields.value.length ||
      resultFields.value.length ||
      inputPreview.value ||
      stringifyToolValue(model.value.result)
  )
})

const statusLabel = computed(() => {
  if (model.value.status === 'error') return '执行失败'
  if (model.value.status === 'complete') return '执行完成'
  return '执行中'
})

const statusClass = computed(() => `tool-rich-${model.value.status}`)

function toggleExpanded() {
  if (hasDetail.value) expanded.value = !expanded.value
}

function formatPath(path: string) {
  if (!path) return ''
  return path.replace(/^\/workspace\/?/, '')
}

function previewText(value: string) {
  return value
}

function todoStatusLabel(status?: unknown) {
  if (status === 'completed') return '已完成'
  if (status === 'in_progress') return '进行中'
  return '待处理'
}

function todoStatusClass(status?: unknown) {
  if (status === 'completed') return 'todo-complete'
  if (status === 'in_progress') return 'todo-active'
  return 'todo-pending'
}
</script>

<template>
  <div :class="['tool-rich-card', statusClass]">
    <button
      type="button"
      class="tool-rich-header"
      :class="{ 'tool-rich-header-clickable': hasDetail }"
      @click="toggleExpanded"
    >
      <span class="tool-rich-dot"></span>
      <span class="tool-rich-name">{{ model.toolName }}</span>
      <span class="tool-rich-summary">{{ model.summary }}</span>
      <span class="tool-rich-status">{{ statusLabel }}</span>
      <span v-if="hasDetail" class="tool-rich-chevron">{{ expanded ? '▾' : '▸' }}</span>
    </button>

    <div v-if="expanded && hasDetail" class="tool-rich-body">
      <template v-if="model.toolName === 'Bash'">
        <div v-if="command" class="tool-rich-section">
          <div class="tool-rich-label">Command</div>
          <pre class="tool-rich-code"><code>{{ command }}</code></pre>
        </div>
        <div v-else-if="inputPreview" class="tool-rich-section">
          <div class="tool-rich-label">Input</div>
          <pre class="tool-rich-code"><code>{{ inputPreview }}</code></pre>
        </div>
        <div v-if="textResult" class="tool-rich-section">
          <div class="tool-rich-label">Output</div>
          <pre class="tool-rich-code"><code>{{ previewText(textResult) }}</code></pre>
        </div>
      </template>

      <template v-else-if="model.toolName === 'Read'">
        <div v-if="filePath" class="tool-rich-file">{{ formatPath(filePath) }}</div>
        <pre
          v-if="textResult"
          class="tool-rich-code"
        ><code>{{ previewText(textResult) }}</code></pre>
        <pre v-else-if="inputPreview" class="tool-rich-code"><code>{{ inputPreview }}</code></pre>
      </template>

      <template v-else-if="model.toolName === 'Edit' || model.toolName === 'Write'">
        <div v-if="filePath" class="tool-rich-file">{{ formatPath(filePath) }}</div>
        <pre
          v-if="model.toolName === 'Write' && writeContent"
          class="tool-rich-code"
        ><code>{{ previewText(writeContent) }}</code></pre>
        <div
          v-else-if="model.toolName === 'Edit' && (editBefore || editAfter)"
          class="tool-rich-diff"
        >
          <div v-if="editBefore" class="tool-rich-diff-block tool-rich-diff-remove">
            <div class="tool-rich-label">Before</div>
            <pre><code>{{ previewText(editBefore) }}</code></pre>
          </div>
          <div v-if="editAfter" class="tool-rich-diff-block tool-rich-diff-add">
            <div class="tool-rich-label">After</div>
            <pre><code>{{ previewText(editAfter) }}</code></pre>
          </div>
        </div>
        <pre
          v-else-if="textResult"
          class="tool-rich-code"
        ><code>{{ previewText(textResult) }}</code></pre>
        <pre v-else-if="inputPreview" class="tool-rich-code"><code>{{ inputPreview }}</code></pre>
      </template>

      <template v-else-if="model.toolName === 'UpdatePlan'">
        <div class="tool-rich-todos">
          <div
            v-for="(plan, index) in planItems"
            :key="`${plan.step}-${index}`"
            :class="['tool-rich-todo', todoStatusClass(plan.status)]"
          >
            <span class="tool-rich-todo-index">{{ index + 1 }}</span>
            <span class="tool-rich-todo-text">{{ plan.step }}</span>
            <span class="tool-rich-todo-status">{{ todoStatusLabel(plan.status) }}</span>
          </div>
        </div>
      </template>

      <template v-else-if="model.toolName === 'TodoWrite'">
        <div class="tool-rich-todos">
          <div
            v-for="(todo, index) in todoItems"
            :key="`${String((todo as any).content || index)}-${index}`"
            :class="['tool-rich-todo', todoStatusClass((todo as any).status)]"
          >
            <span class="tool-rich-todo-index">{{ index + 1 }}</span>
            <span class="tool-rich-todo-text">{{ (todo as any).content || String(todo) }}</span>
            <span class="tool-rich-todo-status">{{ todoStatusLabel((todo as any).status) }}</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="inputFields.length" class="tool-rich-section">
          <div class="tool-rich-label">Input</div>
          <div class="tool-rich-fields">
            <div v-for="field in inputFields" :key="`input-${field.key}`" class="tool-rich-field">
              <div class="tool-rich-field-label">{{ field.label }}</div>
              <pre
                v-if="field.multiline"
                class="tool-rich-code"
              ><code>{{ previewText(field.value) }}</code></pre>
              <div v-else class="tool-rich-field-value">{{ field.value }}</div>
            </div>
          </div>
        </div>
        <div v-if="resultFields.length" class="tool-rich-section">
          <div class="tool-rich-label">Result</div>
          <div class="tool-rich-fields">
            <div v-for="field in resultFields" :key="`result-${field.key}`" class="tool-rich-field">
              <div class="tool-rich-field-label">{{ field.label }}</div>
              <pre
                v-if="field.multiline"
                class="tool-rich-code"
              ><code>{{ previewText(field.value) }}</code></pre>
              <div v-else class="tool-rich-field-value">{{ field.value }}</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tool-rich-card {
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.76);
  color: #1f2937;
}

:global(.dark) .tool-rich-card {
  border-color: rgba(75, 85, 99, 0.65);
  background: rgba(31, 41, 55, 0.58);
  color: #f3f4f6;
}

.tool-rich-header {
  display: flex;
  min-height: 42px;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  padding: 9px 12px;
  text-align: left;
}

.tool-rich-header-clickable {
  cursor: pointer;
}

.tool-rich-header-clickable:hover {
  background: rgba(148, 163, 184, 0.1);
}

.tool-rich-dot {
  height: 8px;
  width: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #60a5fa;
}

.tool-rich-complete .tool-rich-dot {
  background: #22c55e;
}

.tool-rich-error .tool-rich-dot {
  background: #ef4444;
}

.tool-rich-pending .tool-rich-dot {
  animation: tool-pulse 1.3s ease-in-out infinite;
}

@keyframes tool-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.82);
  }
}

.tool-rich-name {
  flex: 0 0 auto;
  font-weight: 700;
  font-size: 13px;
}

.tool-rich-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #64748b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .tool-rich-summary {
  color: #a5b4fc;
}

.tool-rich-status {
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  font-size: 12px;
  padding: 2px 8px;
}

.tool-rich-complete .tool-rich-status {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.tool-rich-error .tool-rich-status {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.tool-rich-chevron {
  width: 16px;
  color: #64748b;
  text-align: center;
}

.tool-rich-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  padding: 10px 12px 12px;
}

.tool-rich-label {
  margin-bottom: 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.tool-rich-file {
  color: #2563eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  word-break: break-all;
}

:global(.dark) .tool-rich-file {
  color: #93c5fd;
}

.tool-rich-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-rich-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.tool-rich-field-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.tool-rich-field-value {
  overflow-wrap: anywhere;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.12);
  padding: 7px 9px;
  font-size: 13px;
  line-height: 1.55;
}

:global(.dark) .tool-rich-field-value {
  background: rgba(15, 23, 42, 0.32);
}

.tool-rich-code,
.tool-rich-diff pre {
  max-height: 360px;
  overflow: auto;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.06);
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

:global(.dark) .tool-rich-code,
:global(.dark) .tool-rich-diff pre {
  background: rgba(15, 23, 42, 0.42);
}

.tool-rich-diff {
  display: grid;
  gap: 10px;
}

.tool-rich-diff-remove pre {
  border-left: 3px solid #ef4444;
}

.tool-rich-diff-add pre {
  border-left: 3px solid #22c55e;
}

.tool-rich-todos {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-rich-todo {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 6px 8px;
  background: rgba(148, 163, 184, 0.1);
  font-size: 13px;
}

.tool-rich-todo-index {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.tool-rich-todo-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tool-rich-todo-status {
  color: #64748b;
  font-size: 12px;
}

.todo-complete .tool-rich-todo-text {
  color: #64748b;
  text-decoration: line-through;
}

.todo-active {
  background: rgba(59, 130, 246, 0.12);
}

.todo-complete {
  background: rgba(34, 197, 94, 0.1);
}
</style>
