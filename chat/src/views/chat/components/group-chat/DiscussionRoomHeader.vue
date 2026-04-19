<script setup lang="ts">
import type { DiscussionParticipant, DiscussionRoom } from './types'
import { formatTimeLabel, getAvatarStyle, getInitials } from './utils'

interface Props {
  room: DiscussionRoom
  selectedParticipantId?: string | null
}

interface Emit {
  (ev: 'close'): void
  (ev: 'stop'): void
  (ev: 'add-expert'): void
  (ev: 'select-participant', participantId: string): void
}

defineProps<Props>()
defineEmits<Emit>()

function getExperts(participants: DiscussionParticipant[]) {
  return participants.filter(item => item.participantType === 'expert')
}

function getResponseLengthLabel(value: DiscussionRoom['responseLength']) {
  if (value === 'brief') return '简短回复'
  if (value === 'deep') return '深入回复'
  return '标准回复'
}
</script>

<template>
  <div class="border-b border-white/10 px-6 py-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-primary-500/15 px-2 py-1 text-[11px] text-primary-200">
            专家讨论房间
          </span>
          <span class="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-300">
            第 {{ room.currentRound }} / {{ room.maxRounds }} 轮
          </span>
          <span class="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-300">
            {{ getResponseLengthLabel(room.responseLength) }}
          </span>
          <span class="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-300">
            {{
              room.status === 'finished'
                ? '已结束'
                : room.status === 'stopped'
                  ? '已停止'
                  : '讨论中'
            }}
          </span>
        </div>
        <h2 class="truncate text-xl font-semibold text-white">{{ room.topic }}</h2>
        <p class="mt-1 text-sm text-slate-400">
          {{ room.goal || '把核心分歧讲透' }} · 创建于 {{ formatTimeLabel(room.createdAt) }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
          @click="$emit('add-expert')"
        >
          添加专家
        </button>
        <button
          type="button"
          class="rounded-xl border border-rose-500/30 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
          @click="$emit('stop')"
        >
          停止讨论
        </button>
        <button
          type="button"
          class="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
          @click="$emit('close')"
        >
          返回
        </button>
      </div>
    </div>

    <div class="mt-5 flex items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          v-for="participant in getExperts(room.participants)"
          :key="participant.id"
          type="button"
          class="flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left transition"
          :class="
            selectedParticipantId === participant.id
              ? 'border-primary-400/40 bg-primary-500/10'
              : 'border-white/10 bg-white/5 hover:bg-white/10'
          "
          @click="$emit('select-participant', participant.id)"
        >
          <span
            class="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            :style="getAvatarStyle(participant.displayName)"
          >
            {{ getInitials(participant.displayName) }}
          </span>
          <span class="hidden pr-2 text-xs text-slate-200 md:block">{{
            participant.displayName
          }}</span>
        </button>
      </div>
      <p class="max-w-[28rem] text-right text-xs text-slate-400">
        群主优先放大有价值的分歧；用户可随时插话、点名专家或追加新成员。
      </p>
    </div>
  </div>
</template>
