<script setup lang="ts">
interface Props {
  items?: string[]
  live?: boolean
}

defineProps<Props>()
</script>

<template>
  <div v-if="items?.length" class="mb-2 flex flex-wrap gap-2">
    <span
      v-for="item in items"
      :key="item"
      class="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]"
      :class="
        live
          ? 'border-primary-400/30 bg-primary-500/10 text-primary-100'
          : 'border-white/80 bg-white/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300'
      "
    >
      <span v-if="live" class="h-1.5 w-1.5 rounded-full bg-primary-300 animate-pulse"></span>
      {{ item }}
    </span>
  </div>
</template>
