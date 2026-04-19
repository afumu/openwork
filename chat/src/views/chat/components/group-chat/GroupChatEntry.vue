<script setup lang="ts">
interface Props {
  disabled?: boolean
  hasResume?: boolean
}

interface Emit {
  (ev: 'open'): void
  (ev: 'resume'): void
}

defineProps<Props>()
defineEmits<Emit>()
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="btn-pill btn-md mx-1 transition-all duration-200"
      :class="disabled ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-0.5'"
      :disabled="disabled"
      @click="$emit('open')"
      aria-label="打开专家会商建房抽屉"
    >
      <span>会商</span>
    </button>
    <button
      v-if="hasResume"
      type="button"
      class="text-xs px-2.5 py-1 rounded-full border border-primary-200 text-primary-600 bg-primary-50 dark:bg-primary-500/10 dark:border-primary-500/30 dark:text-primary-300"
      @click="$emit('resume')"
    >
      续会
    </button>
  </div>
</template>
