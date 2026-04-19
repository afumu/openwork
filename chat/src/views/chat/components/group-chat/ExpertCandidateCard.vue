<script setup lang="ts">
import { ref } from 'vue'
import type { ExpertCandidate } from './types'
import DiscussionPersonaPanel from './DiscussionPersonaPanel.vue'

interface Props {
  candidate: ExpertCandidate
  selected: boolean
}

interface Emit {
  (ev: 'toggle'): void
  (ev: 'update:personaPrompt', value: string): void
  (ev: 'regenerate', extraNeed: string): void
}

defineProps<Props>()
defineEmits<Emit>()

const showPersona = ref(false)
</script>

<template>
  <div
    class="rounded-2xl border p-4 transition-all duration-200"
    :class="
      selected
        ? 'border-primary-400 bg-primary-50/80 dark:bg-primary-500/10 dark:border-primary-500/40 shadow-sm'
        : 'border-gray-200 bg-white/70 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/70'
    "
  >
    <button type="button" class="w-full text-left" @click="$emit('toggle')">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ candidate.name }}
            </h4>
            <span
              v-if="candidate.recommended"
              class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              建议参会
            </span>
            <span
              class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            >
              {{ candidate.tier }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ candidate.identity }} · {{ candidate.organization }}
          </p>
        </div>
        <div
          class="flex h-5 w-5 items-center justify-center rounded-full border text-[11px]"
          :class="
            selected
              ? 'border-primary-500 bg-primary-500 text-white'
              : 'border-gray-300 text-transparent dark:border-gray-600'
          "
        >
          ✓
        </div>
      </div>

      <div class="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span
          class="rounded-full bg-slate-100 px-2 py-1 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          {{ candidate.perspective }}
        </span>
        <span
          class="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {{ candidate.stance }}
        </span>
        <span
          class="rounded-full px-2 py-1"
          :class="
            candidate.evidenceScore >= 86
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
          "
        >
          {{ candidate.evidenceLabel }}
        </span>
      </div>

      <p class="text-sm leading-6 text-gray-600 dark:text-gray-300">
        {{ candidate.recommendationReason }}
      </p>

      <div class="mt-3 flex flex-wrap gap-2">
        <span
          v-for="tag in candidate.expertise"
          :key="tag"
          class="rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          {{ tag }}
        </span>
      </div>
    </button>

    <div class="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
      <button
        type="button"
        class="text-xs font-medium text-primary-600 dark:text-primary-300"
        @click="showPersona = !showPersona"
      >
        {{ showPersona ? '收起人设 prompt' : '查看人设 prompt' }}
      </button>

      <div v-if="showPersona" class="mt-3">
        <DiscussionPersonaPanel
          compact
          :entity="{
            id: candidate.id,
            displayName: candidate.name,
            roleSummary: `${candidate.identity} · ${candidate.organization}`,
            perspective: candidate.perspective,
            stance: candidate.stance,
            personaPrompt: candidate.personaPrompt,
            evidenceLabel: candidate.evidenceLabel,
            expertise: candidate.expertise,
          }"
          @update:personaPrompt="$emit('update:personaPrompt', $event)"
          @regenerate="$emit('regenerate', $event)"
        />
      </div>
    </div>
  </div>
</template>
