<script setup lang="ts">
import { useAppStore } from '@/store'
import { Close } from '@icon-park/vue-next'
import { computed } from 'vue'
import ArtifactWorkspace from './workspace/ArtifactWorkspace.vue'

const props = defineProps<{
  visible: boolean
  groupId: number
  isStreaming: boolean
  initialPath?: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const appStore = useAppStore()

const drawerClass = computed(() => {
  return props.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98] pointer-events-none'
})

const isDarkTheme = computed(() => {
  if (appStore.theme === 'dark') return true
  if (typeof document === 'undefined') return false
  const html = document.documentElement
  return html.classList.contains('dark') || html.dataset.theme === 'dark'
})

const workspaceLabel = computed(() => {
  return props.isStreaming ? '文件会在任务执行过程中持续出现' : '当前对话工作区'
})
</script>

<template>
  <transition name="artifact-backdrop">
    <div
      v-if="visible"
      class="artifact-backdrop-layer fixed inset-0 z-40 backdrop-blur-[4px]"
      :class="{ 'artifact-backdrop-layer-dark': isDarkTheme }"
      @click="emit('close')"
    />
  </transition>

  <aside
    class="artifact-drawer fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ease-out md:p-8"
    :class="[drawerClass, { 'artifact-drawer-dark': isDarkTheme }]"
  >
    <div class="artifact-panel" @click.stop>
      <header class="artifact-header">
        <div class="min-w-0">
          <h2 class="artifact-title">此任务中的所有文件</h2>
          <p class="artifact-subtitle">{{ workspaceLabel }}</p>
        </div>

        <button class="artifact-close-btn" type="button" @click="emit('close')">
          <Close size="18" />
        </button>
      </header>

      <ArtifactWorkspace
        class="min-h-0 flex-1"
        :group-id="groupId"
        :initial-path="initialPath"
        :is-streaming="isStreaming"
        mode="drawer"
      />
    </div>
  </aside>
</template>

<style scoped>
.artifact-backdrop-layer {
  background: rgba(15, 23, 42, 0.18);
}

:global(html.dark) .artifact-backdrop-layer,
:global(html[data-theme='dark']) .artifact-backdrop-layer,
.artifact-backdrop-layer-dark {
  background: rgba(0, 0, 0, 0.56);
}

.artifact-drawer {
  --artifact-panel-bg:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98));
  --artifact-panel-border: rgba(15, 23, 42, 0.08);
  --artifact-panel-shadow: 0 22px 80px rgba(15, 23, 42, 0.16);
  --artifact-surface: rgba(255, 255, 255, 0.76);
  --artifact-surface-hover: rgba(241, 245, 249, 0.92);
  --artifact-surface-active: rgba(239, 246, 255, 0.96);
  --artifact-border: rgba(15, 23, 42, 0.1);
  --artifact-border-strong: rgba(59, 130, 246, 0.28);
  --artifact-text: #111827;
  --artifact-muted: rgba(51, 65, 85, 0.66);
  --artifact-chip-active-bg: rgba(37, 99, 235, 0.12);
  --artifact-chip-active-text: #1d4ed8;
  --artifact-modal-bg: #ffffff;
  --artifact-modal-topbar-bg: rgba(255, 255, 255, 0.92);
  --artifact-control-bg: rgba(15, 23, 42, 0.04);
  --artifact-danger-bg: rgba(239, 68, 68, 0.08);
  --artifact-danger-border: rgba(239, 68, 68, 0.18);
  --artifact-danger-text: #b91c1c;
  --artifact-skeleton-a: rgba(226, 232, 240, 0.72);
  --artifact-skeleton-b: rgba(248, 250, 252, 0.96);
}

:global(html.dark) .artifact-drawer,
:global(html[data-theme='dark']) .artifact-drawer,
.artifact-drawer-dark {
  --artifact-panel-bg: linear-gradient(180deg, rgba(42, 42, 42, 0.98), rgba(32, 32, 32, 0.98));
  --artifact-panel-border: rgba(255, 255, 255, 0.08);
  --artifact-panel-shadow: 0 18px 80px rgba(0, 0, 0, 0.42);
  --artifact-surface: rgba(255, 255, 255, 0.03);
  --artifact-surface-hover: rgba(255, 255, 255, 0.05);
  --artifact-surface-active: rgba(255, 255, 255, 0.07);
  --artifact-border: rgba(255, 255, 255, 0.08);
  --artifact-border-strong: rgba(96, 165, 250, 0.34);
  --artifact-text: #f4f4f5;
  --artifact-muted: rgba(244, 244, 245, 0.58);
  --artifact-chip-active-bg: rgba(255, 255, 255, 0.12);
  --artifact-chip-active-text: #fafafa;
  --artifact-modal-bg: #202123;
  --artifact-modal-topbar-bg: rgba(32, 32, 34, 0.96);
  --artifact-control-bg: rgba(255, 255, 255, 0.03);
  --artifact-danger-bg: rgba(248, 113, 113, 0.1);
  --artifact-danger-border: rgba(248, 113, 113, 0.16);
  --artifact-danger-text: #fecaca;
  --artifact-skeleton-a: rgba(255, 255, 255, 0.04);
  --artifact-skeleton-b: rgba(255, 255, 255, 0.09);
}

.artifact-panel {
  display: flex;
  width: min(1080px, 100%);
  height: min(82vh, 860px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--artifact-panel-border);
  background: var(--artifact-panel-bg);
  box-shadow: var(--artifact-panel-shadow);
  color: var(--artifact-text);
}

.artifact-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 26px 28px 10px;
}

.artifact-title {
  margin: 0;
  color: var(--artifact-text);
  font-size: 21px;
  font-weight: 700;
}

.artifact-subtitle {
  margin-top: 8px;
  color: var(--artifact-muted);
  font-size: 13px;
  line-height: 1.6;
}

.artifact-close-btn {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--artifact-muted);
  cursor: pointer;
}

.artifact-close-btn:hover {
  background: var(--artifact-control-bg);
  color: var(--artifact-text);
}

.artifact-modal-doc-surface :deep(.md-editor-preview ul) {
  list-style: disc;
}

.artifact-modal-doc-surface :deep(.md-editor-preview ol) {
  list-style: decimal;
}

.artifact-backdrop-enter-active,
.artifact-backdrop-leave-active {
  transition: all 180ms ease;
}

.artifact-backdrop-enter-from,
.artifact-backdrop-leave-to {
  opacity: 0;
}

@media (max-width: 1024px) {
  .artifact-panel {
    width: 100%;
    height: 100%;
    border-radius: 24px;
  }
}
</style>
