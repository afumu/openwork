<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import DiscussionAgentStatus from './DiscussionAgentStatus.vue'
import DiscussionMessageMeta from './DiscussionMessageMeta.vue'
import DiscussionPersonaPanel from './DiscussionPersonaPanel.vue'
import DiscussionRoomHeader from './DiscussionRoomHeader.vue'
import type { DiscussionMessage, DiscussionRoom } from './types'
import { formatTimeLabel, getAvatarStyle, getInitials } from './utils'

interface Props {
  visible: boolean
  room: DiscussionRoom | null
}

interface Emit {
  (ev: 'close'): void
  (ev: 'stop'): void
  (ev: 'send', payload: { content: string; isInterrupt: boolean }): void
  (ev: 'continue'): void
  (ev: 'add-expert', name: string): void
  (
    ev: 'update:participantPersonaPrompt',
    payload: { participantId: string; personaPrompt: string }
  ): void
  (
    ev: 'regenerate-participant-persona',
    payload: { participantId: string; extraNeed: string }
  ): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const composer = ref('')
const isInterrupt = ref(false)
const addExpertMode = ref(false)
const newExpertName = ref('')
const timelineRef = ref<HTMLElement | null>(null)
const selectedParticipantId = ref<string | null>(null)

const experts = computed(
  () => props.room?.participants.filter(item => item.participantType === 'expert') || []
)
const canContinue = computed(() => props.room && props.room.status === 'discussing')
const selectedParticipant = computed(
  () =>
    props.room?.participants.find(
      item =>
        item.id === selectedParticipantId.value &&
        (item.participantType === 'expert' || item.participantType === 'host')
    ) || null
)

function submitMessage() {
  if (!composer.value.trim()) return
  emit('send', { content: composer.value, isInterrupt: isInterrupt.value })
  composer.value = ''
  nextTick(scrollToBottom)
}

function insertMention(name: string) {
  composer.value = `${composer.value}${composer.value ? ' ' : ''}@${name} `
}

function submitAddExpert() {
  if (!newExpertName.value.trim()) return
  emit('add-expert', newExpertName.value)
  newExpertName.value = ''
  addExpertMode.value = false
  nextTick(scrollToBottom)
}

function scrollToBottom() {
  if (!timelineRef.value) return
  timelineRef.value.scrollTop = timelineRef.value.scrollHeight
}

function selectParticipant(participantId: string) {
  selectedParticipantId.value = participantId
}

watch(
  () => props.room?.participants,
  participants => {
    if (!participants?.length) {
      selectedParticipantId.value = null
      return
    }

    const stillExists = participants.some(item => item.id === selectedParticipantId.value)
    if (!selectedParticipantId.value || !stillExists) {
      const firstExpert = participants.find(item => item.participantType === 'expert')
      selectedParticipantId.value = firstExpert?.id || 'host'
    }
  },
  { immediate: true, deep: true }
)

watch(
  () => props.room?.messages.length,
  () => nextTick(scrollToBottom)
)

watch(
  () => props.visible,
  visible => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = visible ? 'hidden' : ''
    }
    if (visible) nextTick(scrollToBottom)
  }
)

function isSystemStyle(message: DiscussionMessage) {
  return (
    message.messageType === 'discussion_summary' || message.messageType === 'expert_join_notice'
  )
}

function getLiveStatusLabel(phase: DiscussionRoom['liveResponders'][number]['phase']) {
  if (phase === 'searching') return '正在搜索公开资料'
  if (phase === 'replying') return '正在组织发言'
  return '正在梳理下一轮'
}
</script>

<template>
  <teleport to="body">
    <transition name="discussion-room-fade">
      <div v-if="visible && room" class="fixed inset-0 z-[130]">
        <div
          class="absolute inset-0 bg-slate-950/82 backdrop-blur-sm"
          @click="$emit('close')"
        ></div>

        <div class="absolute inset-0 flex items-center justify-center p-3 md:p-6">
          <div
            class="relative grid h-full max-h-[94vh] w-full max-w-[1560px] grid-cols-1 overflow-hidden rounded-[30px] border border-white/10 bg-slate-950 text-white shadow-[0_40px_120px_rgba(15,23,42,0.45)] lg:grid-cols-[minmax(0,1fr)_360px]"
          >
            <div
              class="relative flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r"
            >
              <div
                class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.12),_transparent_24%)]"
              ></div>
              <div class="relative flex min-h-0 flex-1 flex-col">
                <DiscussionRoomHeader
                  :room="room"
                  :selectedParticipantId="selectedParticipantId"
                  @close="$emit('close')"
                  @stop="$emit('stop')"
                  @add-expert="addExpertMode = !addExpertMode"
                  @select-participant="selectParticipant"
                />

                <div ref="timelineRef" class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
                  <div class="mx-auto max-w-5xl">
                    <div
                      class="mb-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
                    >
                      {{ room.hostDisclaimer }}
                    </div>

                    <div
                      v-if="addExpertMode"
                      class="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <input
                        v-model="newExpertName"
                        class="flex-1 rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm outline-none"
                        placeholder="输入真实专家姓名，例如 Geoffrey Hinton"
                        @keyup.enter="submitAddExpert"
                      />
                      <button
                        type="button"
                        class="rounded-xl bg-primary-600 px-4 py-3 text-sm text-white"
                        @click="submitAddExpert"
                      >
                        加入房间
                      </button>
                    </div>

                    <div
                      v-if="room.liveResponders.length"
                      class="mb-5 rounded-2xl border border-primary-400/20 bg-primary-500/10 p-4"
                    >
                      <div class="mb-3 text-xs uppercase tracking-[0.18em] text-primary-200">
                        正在回复
                      </div>
                      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div
                          v-for="responder in room.liveResponders"
                          :key="responder.participantId"
                          class="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-3"
                        >
                          <div
                            class="relative flex h-10 w-10 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                            :style="getAvatarStyle(responder.displayName)"
                          >
                            <span
                              class="absolute inset-0 rounded-full animate-ping bg-white/20"
                            ></span>
                            <span class="relative">{{ getInitials(responder.displayName) }}</span>
                          </div>
                          <div class="min-w-0">
                            <div class="truncate text-sm font-medium text-white">
                              {{ responder.displayName }}
                            </div>
                            <div class="mt-1 flex items-center gap-2 text-xs text-primary-100">
                              <span
                                class="h-1.5 w-1.5 rounded-full bg-primary-300 animate-pulse"
                              ></span>
                              {{ getLiveStatusLabel(responder.phase) }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="space-y-5 pb-6">
                      <div
                        v-for="message in room.messages"
                        :key="message.id"
                        :class="
                          isSystemStyle(message)
                            ? 'flex justify-center'
                            : message.participantType === 'user'
                              ? 'flex justify-end'
                              : 'flex justify-start'
                        "
                      >
                        <div
                          v-if="isSystemStyle(message)"
                          class="max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
                        >
                          <div class="mb-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            {{
                              message.messageType === 'discussion_summary'
                                ? 'discussion summary'
                                : 'expert joined'
                            }}
                          </div>
                          <p class="whitespace-pre-wrap leading-7">{{ message.content }}</p>
                        </div>

                        <div
                          v-else
                          class="flex max-w-3xl gap-3"
                          :class="message.participantType === 'user' ? 'flex-row-reverse' : ''"
                        >
                          <button
                            type="button"
                            class="h-10 w-10 flex-shrink-0 rounded-full text-xs font-semibold text-white"
                            :style="getAvatarStyle(message.displayName)"
                            @click="
                              message.participantType !== 'user'
                                ? selectParticipant(message.participantId)
                                : undefined
                            "
                          >
                            {{ getInitials(message.displayName) }}
                          </button>

                          <div>
                            <DiscussionMessageMeta
                              v-if="message.participantType !== 'user'"
                              :name="message.displayName"
                              :roleSummary="message.roleSummary"
                              :perspective="message.perspective"
                              :stance="message.stance"
                              :isHost="message.participantType === 'host'"
                            />
                            <div v-if="message.participantType !== 'user'" class="max-w-2xl">
                              <DiscussionAgentStatus :items="message.statusItems" />
                            </div>
                            <div
                              class="rounded-[28px] px-4 py-3 text-sm leading-7 whitespace-pre-wrap shadow-lg"
                              :class="
                                message.participantType === 'user'
                                  ? 'bg-primary-600 text-white rounded-br-md'
                                  : message.participantType === 'host'
                                    ? 'rounded-bl-md border border-white/10 bg-slate-800/90 text-slate-100'
                                    : 'rounded-bl-md bg-white text-slate-800'
                              "
                            >
                              {{ message.content }}
                            </div>
                            <div
                              class="mt-2 text-[11px] text-slate-500"
                              :class="message.participantType === 'user' ? 'text-right' : ''"
                            >
                              第 {{ message.roundIndex }} 轮 ·
                              {{ formatTimeLabel(message.createdAt) }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="border-t border-white/10 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
                  <div class="mx-auto max-w-5xl">
                    <div class="mb-3 flex flex-wrap gap-2">
                      <button
                        v-for="expert in experts"
                        :key="expert.id"
                        type="button"
                        class="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                        @click="insertMention(expert.displayName)"
                      >
                        @{{ expert.displayName }}
                      </button>
                    </div>

                    <div class="rounded-[28px] border border-white/10 bg-white/5 p-3">
                      <textarea
                        v-model="composer"
                        rows="3"
                        class="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                        placeholder="随时插话、@专家、或继续追问下一轮"
                      />
                      <div class="mt-3 flex items-center justify-between gap-3">
                        <label class="flex items-center gap-2 text-xs text-slate-400">
                          <input
                            v-model="isInterrupt"
                            type="checkbox"
                            class="rounded border-white/20 bg-transparent"
                          />
                          标记为打断当前话题
                        </label>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                            :disabled="!canContinue"
                            @click="$emit('continue')"
                          >
                            继续一轮
                          </button>
                          <button
                            type="button"
                            class="rounded-xl bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                            :disabled="!composer.trim()"
                            @click="submitMessage"
                          >
                            发送到房间
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside class="hidden min-h-0 flex-col bg-slate-950/98 lg:flex">
              <div class="border-b border-white/10 px-5 py-4">
                <div class="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Persona Inspector
                </div>
                <h3 class="mt-2 text-lg font-semibold text-white">专家人设面板</h3>
                <p class="mt-1 text-sm text-slate-400">
                  这里可以查看、编辑并重新生成当前专家的人设提示词。
                </p>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto p-5">
                <DiscussionPersonaPanel
                  :entity="selectedParticipant"
                  @update:personaPrompt="
                    value =>
                      selectedParticipant &&
                      $emit('update:participantPersonaPrompt', {
                        participantId: selectedParticipant.id,
                        personaPrompt: value,
                      })
                  "
                  @regenerate="
                    extraNeed =>
                      selectedParticipant &&
                      $emit('regenerate-participant-persona', {
                        participantId: selectedParticipant.id,
                        extraNeed,
                      })
                  "
                />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.discussion-room-fade-enter-active,
.discussion-room-fade-leave-active {
  transition: opacity 0.2s ease;
}

.discussion-room-fade-enter-from,
.discussion-room-fade-leave-to {
  opacity: 0;
}
</style>
