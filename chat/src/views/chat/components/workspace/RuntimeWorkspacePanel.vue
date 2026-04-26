<script setup lang="ts">
import { ref } from 'vue'
import ArtifactWorkspace from './ArtifactWorkspace.vue'
import RuntimeInfoPanel from './RuntimeInfoPanel.vue'
import RuntimePreviewPane from './RuntimePreviewPane.vue'
import RuntimeTerminalLog from './RuntimeTerminalLog.vue'
import type { ArtifactReadResult, RuntimeWorkspaceTab } from './types'

defineProps<{
  artifactCount: number
  chats: Chat.Chat[]
  groupId: number
  initialPath?: string
  isStreaming: boolean
}>()

const activeTab = ref<RuntimeWorkspaceTab>('files')
const selectedFile = ref<ArtifactReadResult | null>(null)

const tabs = [
  { key: 'files', label: '文件' },
  { key: 'preview', label: '预览' },
  { key: 'terminal', label: '终端' },
  { key: 'info', label: '信息' },
] as const

function handlePreviewReady(file: ArtifactReadResult | null) {
  selectedFile.value = file
  if (file) activeTab.value = 'preview'
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-[#111827]"
  >
    <nav
      class="flex h-11 shrink-0 items-center gap-1 border-b border-gray-200 px-2 dark:border-gray-700"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="h-8 rounded-lg px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
        :class="{
          'bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-gray-100': activeTab === tab.key,
        }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div class="min-h-0 flex-1 overflow-hidden">
      <ArtifactWorkspace
        v-show="activeTab === 'files'"
        class="h-full"
        :group-id="groupId"
        :initial-path="initialPath"
        :is-streaming="isStreaming"
        mode="panel"
        @preview-ready="handlePreviewReady"
      />
      <RuntimePreviewPane
        v-show="activeTab === 'preview'"
        class="h-full rounded-none border-0"
        :file="selectedFile"
      />
      <RuntimeTerminalLog
        v-show="activeTab === 'terminal'"
        class="h-full"
        :chats="chats"
        :is-streaming="isStreaming"
      />
      <RuntimeInfoPanel
        v-show="activeTab === 'info'"
        class="h-full"
        :artifact-count="artifactCount"
        :group-id="groupId"
        :is-streaming="isStreaming"
      />
    </div>
  </aside>
</template>
