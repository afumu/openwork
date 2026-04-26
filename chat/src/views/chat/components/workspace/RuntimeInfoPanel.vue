<script setup lang="ts">
import { fetchRuntimeStatusAPI } from '@/api/runtime'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { RuntimeStatusPayload } from './types'

const props = defineProps<{
  artifactCount: number
  groupId: number
  isStreaming: boolean
}>()

const loading = ref(false)
const loadError = ref('')
const status = ref<RuntimeStatusPayload | null>(null)
const refreshTimer = ref<number | null>(null)

const rows = computed(() => [
  { label: 'Group ID', value: props.groupId || '--' },
  { label: 'Streaming', value: props.isStreaming ? '进行中' : '空闲' },
  { label: 'Artifacts', value: props.artifactCount },
  { label: 'Mode', value: status.value?.mode || '--' },
  { label: 'Running', value: status.value?.running ? '是' : '否' },
  { label: 'Status', value: status.value?.status || '--' },
  { label: 'Container', value: status.value?.containerName || '--' },
  { label: 'Host Port', value: status.value?.hostPort || '--' },
  { label: 'Volume', value: status.value?.volumeName || '--' },
])

function clearRefreshTimer() {
  if (!refreshTimer.value) return
  window.clearInterval(refreshTimer.value)
  refreshTimer.value = null
}

async function loadRuntimeStatus(showLoading = true) {
  if (!props.groupId) {
    status.value = null
    return
  }

  if (showLoading) loading.value = true
  loadError.value = ''

  try {
    const res: any = await fetchRuntimeStatusAPI<{ data?: RuntimeStatusPayload }>({
      groupId: props.groupId,
    })
    status.value = res?.data || res || null
  } catch (error: any) {
    loadError.value = error?.message || '运行时状态加载失败'
  } finally {
    loading.value = false
  }
}

function restartRefreshTimer() {
  clearRefreshTimer()
  if (!props.groupId || !props.isStreaming) return
  refreshTimer.value = window.setInterval(() => {
    void loadRuntimeStatus(false)
  }, 5000)
}

watch(
  () => props.groupId,
  () => {
    void loadRuntimeStatus(true)
    restartRefreshTimer()
  },
  { immediate: true }
)

watch(
  () => props.isStreaming,
  () => {
    restartRefreshTimer()
  }
)

onBeforeUnmount(() => {
  clearRefreshTimer()
})
</script>

<template>
  <section class="custom-scrollbar h-full overflow-y-auto bg-white p-4 dark:bg-gray-900">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">运行时信息</div>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ loading ? '正在刷新状态' : '当前对话工作区' }}
        </div>
      </div>
      <button
        type="button"
        class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        @click="loadRuntimeStatus(true)"
      >
        刷新
      </button>
    </div>

    <div
      v-if="loadError"
      class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"
    >
      {{ loadError }}
    </div>

    <div class="grid gap-2">
      <div
        v-for="row in rows"
        :key="row.label"
        class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-white/[0.03]"
      >
        <div class="text-[11px] font-semibold uppercase text-gray-400">{{ row.label }}</div>
        <div class="mt-1 break-words text-sm text-gray-900 dark:text-gray-100">
          {{ row.value }}
        </div>
      </div>
    </div>
  </section>
</template>
