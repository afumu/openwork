<script setup lang="ts">
import { TreeView } from '@grapoza/vue-tree'
import '@grapoza/vue-tree/css'
import { watch, ref } from 'vue'
import { buildIdeTreeNodes } from './ideWorkspace'
import type { IdeTreeNode } from './ideWorkspace'
import type { ArtifactWorkspaceTreeItem } from './types'

const props = defineProps<{
  loading: boolean
  selectedPath: string
  tree: ArtifactWorkspaceTreeItem[]
}>()

const emit = defineEmits<{
  (event: 'refresh'): void
  (event: 'select-file', payload: { path: string; runId?: string | null }): void
}>()

const treeModel = ref<IdeTreeNode[]>([])

watch(
  () => props.tree,
  tree => {
    treeModel.value = buildIdeTreeNodes(tree)
  },
  { deep: true, immediate: true }
)

function handleSelect(node: any) {
  const data = node?.data || node
  if (data?.nodeType !== 'file') return
  emit('select-file', {
    path: data.path,
    runId: data.runId,
  })
}
</script>

<template>
  <aside class="runtime-file-explorer flex h-full min-h-0 flex-col bg-[#080808] text-zinc-100">
    <header class="flex h-12 shrink-0 items-center justify-between px-4">
      <span class="text-sm font-medium">Projects</span>
      <div class="flex items-center gap-1 text-zinc-400">
        <button class="ide-icon-btn" type="button" title="刷新" @click="emit('refresh')">↻</button>
        <button class="ide-icon-btn" type="button" title="新文件">＋</button>
      </div>
    </header>

    <div v-if="loading" class="grid gap-2 px-4 py-2">
      <div v-for="index in 6" :key="index" class="h-7 rounded bg-white/8" />
    </div>

    <div
      v-else-if="treeModel.length"
      class="custom-scrollbar min-h-0 flex-1 overflow-auto px-2 pb-4"
    >
      <TreeView
        id="runtime-workspace-file-tree"
        v-model="treeModel"
        class="runtime-file-tree"
        @tree-node-click="handleSelect"
      />
    </div>

    <div v-else class="px-4 py-6 text-sm text-zinc-500">当前工作区还没有文件</div>
  </aside>
</template>

<style scoped>
.runtime-file-explorer {
  --tree-row-hover: rgba(255, 255, 255, 0.07);
}

.ide-icon-btn {
  display: inline-flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #d4d4d8;
  font-size: 16px;
  line-height: 1;
}

.ide-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.runtime-file-tree :deep(*) {
  color: inherit;
}

.runtime-file-tree :deep(.grtvn-self) {
  min-height: 34px;
  border-radius: 8px;
  padding: 2px 6px;
}

.runtime-file-tree :deep(.grtvn-self:hover) {
  background: var(--tree-row-hover);
}

.runtime-file-tree :deep(.grtvn-self-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.runtime-file-tree :deep(.grtvn-self-expanded-indicator) {
  color: #a1a1aa;
}
</style>
