<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DiscussionParticipant, ExpertCandidate } from './types'

type PersonaEntity = Pick<
  DiscussionParticipant,
  'id' | 'displayName' | 'roleSummary' | 'perspective' | 'stance' | 'personaPrompt'
> &
  Partial<Pick<ExpertCandidate, 'evidenceLabel' | 'expertise'>>

interface Props {
  entity: PersonaEntity | null
  compact?: boolean
}

interface Emit {
  (ev: 'update:personaPrompt', value: string): void
  (ev: 'regenerate', extraNeed: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const personaPrompt = ref('')
const regenerateNeed = ref('')

watch(
  () => props.entity?.personaPrompt,
  value => {
    personaPrompt.value = value || ''
  },
  { immediate: true }
)

const title = computed(() => (props.compact ? '人设 prompt' : '当前专家人设 prompt'))
</script>

<template>
  <div
    class="rounded-2xl border border-white/10 bg-white/5 p-4"
    :class="compact ? 'bg-slate-900/40' : 'bg-white/5'"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-xs uppercase tracking-[0.18em] text-primary-300">{{ title }}</div>
        <h4 class="mt-2 text-sm font-semibold text-white">
          {{ entity?.displayName || '未选择专家' }}
        </h4>
        <p class="mt-1 text-xs text-slate-400">
          {{ entity?.roleSummary || '点击专家头像或名字后在这里查看和调整人设。' }}
        </p>
      </div>
      <div v-if="entity" class="flex flex-wrap gap-2 text-[11px]">
        <span v-if="entity.perspective" class="rounded-full bg-white/10 px-2 py-1 text-slate-200">
          {{ entity.perspective }}
        </span>
        <span v-if="entity.stance" class="rounded-full bg-amber-500/15 px-2 py-1 text-amber-200">
          {{ entity.stance }}
        </span>
        <span
          v-if="entity.evidenceLabel"
          class="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-200"
        >
          {{ entity.evidenceLabel }}
        </span>
      </div>
    </div>

    <template v-if="entity">
      <textarea
        v-model="personaPrompt"
        rows="10"
        class="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-6 text-slate-100 outline-none"
        placeholder="这里会显示当前人设 prompt"
      />

      <div v-if="entity.expertise?.length" class="mt-3 flex flex-wrap gap-2">
        <span
          v-for="tag in entity.expertise"
          :key="tag"
          class="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-300"
        >
          {{ tag }}
        </span>
      </div>

      <div
        class="mt-4 grid gap-3"
        :class="compact ? 'grid-cols-1' : 'grid-cols-[1fr_auto] items-end'"
      >
        <div>
          <label class="mb-2 block text-xs text-slate-400">让 AI 重新生成人设时额外考虑</label>
          <input
            v-model="regenerateNeed"
            class="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none"
            placeholder="例如：更尖锐一些，强调风险和监管代价"
          />
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200"
            @click="$emit('update:personaPrompt', personaPrompt)"
          >
            保存修改
          </button>
          <button
            type="button"
            class="rounded-2xl bg-primary-600 px-4 py-3 text-sm text-white"
            @click="$emit('regenerate', regenerateNeed)"
          >
            AI 重新生成
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
