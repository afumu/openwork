<script setup lang="ts">
interface Props {
  name: string
  roleSummary?: string
  perspective?: string
  stance?: string
  isHost?: boolean
}

defineProps<Props>()
</script>

<template>
  <div class="mb-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ name }}</span>
      <span
        v-if="isHost"
        class="text-[11px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
      >
        群主
      </span>
      <span v-if="roleSummary" class="text-xs text-slate-500 dark:text-slate-400">
        {{ roleSummary }}
      </span>
    </div>
    <div class="mt-1 flex flex-wrap gap-2" v-if="perspective || stance">
      <span
        v-if="perspective"
        class="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
      >
        {{ perspective }}
      </span>
      <span
        v-if="stance"
        class="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      >
        {{ stance }}
      </span>
    </div>
  </div>
</template>
