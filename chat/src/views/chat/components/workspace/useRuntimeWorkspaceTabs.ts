import { computed, ref } from 'vue'
import type { ArtifactReadResult, ArtifactWorkspaceFileItem } from './types'

export interface RuntimeWorkspaceEditorTab {
  baseUpdatedAt: string
  conflict: boolean
  content: string
  dirty: boolean
  file: ArtifactReadResult
  path: string
  savedContent: string
  saving: boolean
}

export function createRuntimeWorkspaceTab(file: ArtifactReadResult): RuntimeWorkspaceEditorTab {
  return {
    baseUpdatedAt: file.updatedAt,
    conflict: false,
    content: file.content,
    dirty: false,
    file,
    path: file.path,
    savedContent: file.content,
    saving: false,
  }
}

export function useRuntimeWorkspaceTabs() {
  const tabs = ref<RuntimeWorkspaceEditorTab[]>([])
  const activePath = ref('')

  const activeTab = computed(() => tabs.value.find(tab => tab.path === activePath.value) || null)

  function setActivePath(path: string) {
    activePath.value = path
  }

  function upsertTab(file: ArtifactReadResult) {
    const existingTab = tabs.value.find(tab => tab.path === file.path)
    if (existingTab) {
      existingTab.baseUpdatedAt = file.updatedAt
      existingTab.conflict = false
      existingTab.content = file.content
      existingTab.dirty = false
      existingTab.file = file
      existingTab.savedContent = file.content
    } else {
      tabs.value.push(createRuntimeWorkspaceTab(file))
    }
    activePath.value = file.path
  }

  function updateActiveContent(content: string) {
    const tab = activeTab.value
    if (!tab) return
    tab.content = content
    tab.dirty = content !== tab.savedContent
  }

  function markTabSaved(path: string, entry: Pick<ArtifactWorkspaceFileItem, 'updatedAt' | 'type'>) {
    const tab = tabs.value.find(item => item.path === path)
    if (!tab) return
    tab.baseUpdatedAt = entry.updatedAt
    tab.conflict = false
    tab.dirty = false
    tab.file = {
      ...tab.file,
      content: tab.content,
      type: entry.type || tab.file.type,
      updatedAt: entry.updatedAt,
      size: tab.content.length,
      truncated: false,
    }
    tab.savedContent = tab.content
  }

  function markExternalUpdate(file: ArtifactWorkspaceFileItem) {
    const tab = tabs.value.find(item => item.path === file.path)
    if (!tab || tab.baseUpdatedAt === file.updatedAt) return 'unchanged'
    if (tab.dirty) {
      tab.conflict = true
      return 'conflict'
    }
    return 'reload'
  }

  function keepLocalChanges(path: string) {
    const tab = tabs.value.find(item => item.path === path)
    if (!tab) return
    tab.conflict = false
  }

  function closeTab(path: string, confirmClose: (tab: RuntimeWorkspaceEditorTab) => boolean) {
    const tab = tabs.value.find(item => item.path === path)
    if (!tab) return true
    if (tab.dirty && !confirmClose(tab)) return false

    const index = tabs.value.findIndex(item => item.path === path)
    tabs.value.splice(index, 1)
    if (activePath.value === path) {
      activePath.value = tabs.value[Math.max(0, index - 1)]?.path || tabs.value[0]?.path || ''
    }
    return true
  }

  function closeDeletedCleanTabs(paths: Set<string>) {
    tabs.value = tabs.value.filter(tab => tab.dirty || paths.has(tab.path))
    if (activePath.value && !tabs.value.some(tab => tab.path === activePath.value)) {
      activePath.value = tabs.value[0]?.path || ''
    }
  }

  function resetTabs() {
    tabs.value = []
    activePath.value = ''
  }

  return {
    activePath,
    activeTab,
    closeDeletedCleanTabs,
    closeTab,
    keepLocalChanges,
    markExternalUpdate,
    markTabSaved,
    resetTabs,
    setActivePath,
    tabs,
    updateActiveContent,
    upsertTab,
  }
}
