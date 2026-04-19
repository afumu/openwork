<script setup lang="ts">
import { computed, watch } from 'vue'
import type { GroupChatDraft, DiscussionRoom, ResponseLength } from './types'
import ExpertCandidateCard from './ExpertCandidateCard.vue'

interface Props {
  visible: boolean
  draft: GroupChatDraft
  isDiscovering: boolean
  lastRoom: DiscussionRoom | null
}

interface Emit {
  (ev: 'close'): void
  (ev: 'discover'): void
  (ev: 'update:topic', value: string): void
  (ev: 'update:topicContext', value: string): void
  (ev: 'update:goal', value: string): void
  (ev: 'update:responseLength', value: ResponseLength): void
  (ev: 'update:maxRounds', value: number): void
  (ev: 'toggle-candidate', candidateId: string): void
  (ev: 'update:manualExpertName', value: string): void
  (ev: 'add-manual-expert'): void
  (
    ev: 'update:candidatePersonaPrompt',
    payload: { candidateId: string; personaPrompt: string }
  ): void
  (ev: 'regenerate-candidate-persona', payload: { candidateId: string; extraNeed: string }): void
  (ev: 'create-room'): void
  (ev: 'resume-room'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const recommendedCount = computed(
  () => props.draft.candidates.filter(item => item.recommended).length
)
const selectedCount = computed(() => props.draft.selectedCandidateIds.length)

const responseLengthOptions: { value: ResponseLength; label: string; description: string }[] = [
  { value: 'brief', label: '简短', description: '偏结论，回复更利落' },
  { value: 'balanced', label: '标准', description: '信息密度与节奏平衡' },
  { value: 'deep', label: '深入', description: '展开更多论据和层次' },
]

watch(
  () => props.visible,
  visible => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = visible ? 'hidden' : ''
  }
)
</script>

<template>
  <teleport to="body">
    <transition name="group-chat-fade">
      <div v-if="visible" class="fixed inset-0 z-[120]">
        <div
          class="absolute inset-0 bg-slate-950/72 backdrop-blur-sm"
          @click="$emit('close')"
        ></div>

        <div class="absolute inset-0 flex items-center justify-center p-4 md:p-8">
          <div
            class="relative flex h-full max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl dark:bg-slate-950"
          >
            <div
              class="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.02),_transparent)] px-6 py-5 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.2),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.9),_rgba(15,23,42,0.76))]"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.2em] text-primary-500">Expert Council</p>
                  <h3 class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
                    创建专家会商
                  </h3>
                  <p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
                    先配置讨论主题、会商目标和轮数，再生成 10 位候选专家，默认建议其中 5 位参会。
                  </p>
                </div>
                <button
                  type="button"
                  class="h-10 w-10 rounded-full border border-black/10 text-gray-500 dark:border-white/10 dark:text-slate-300"
                  @click="$emit('close')"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div
                class="overflow-y-auto border-b border-black/5 px-6 py-5 dark:border-white/10 lg:border-b-0 lg:border-r"
              >
                <section class="space-y-4">
                  <div>
                    <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-slate-200">
                      主题
                    </label>
                    <textarea
                      rows="4"
                      :value="draft.topic"
                      class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="例如：OpenAI 新模型发布会如何影响企业 Agent 落地"
                      @input="$emit('update:topic', ($event.target as HTMLTextAreaElement).value)"
                    />
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-slate-200">
                      补充说明
                    </label>
                    <textarea
                      rows="3"
                      :value="draft.topicContext"
                      class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="可补充你最关心的事实疑点、约束条件或讨论角度"
                      @input="
                        $emit('update:topicContext', ($event.target as HTMLTextAreaElement).value)
                      "
                    />
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-slate-200">
                      讨论目标
                    </label>
                    <input
                      :value="draft.goal"
                      class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="例如：拆出核心分歧，判断哪些观点值得进入最终方案"
                      @input="$emit('update:goal', ($event.target as HTMLInputElement).value)"
                    />
                  </div>

                  <div>
                    <label class="mb-3 block text-sm font-medium text-gray-700 dark:text-slate-200">
                      回复长度
                    </label>
                    <div class="grid gap-2">
                      <button
                        v-for="option in responseLengthOptions"
                        :key="option.value"
                        type="button"
                        class="rounded-2xl border px-4 py-3 text-left transition"
                        :class="
                          draft.responseLength === option.value
                            ? 'border-primary-400 bg-primary-50 dark:border-primary-500/40 dark:bg-primary-500/10'
                            : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                        "
                        @click="$emit('update:responseLength', option.value)"
                      >
                        <div class="text-sm font-medium text-gray-900 dark:text-white">
                          {{ option.label }}
                        </div>
                        <div class="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {{ option.description }}
                        </div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-slate-200">
                      轮数上限
                    </label>
                    <input
                      :value="draft.maxRounds"
                      type="range"
                      min="2"
                      max="8"
                      class="w-full"
                      @input="
                        $emit('update:maxRounds', Number(($event.target as HTMLInputElement).value))
                      "
                    />
                    <div
                      class="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400"
                    >
                      <span>2 轮</span>
                      <span>当前 {{ draft.maxRounds }} 轮</span>
                      <span>8 轮</span>
                    </div>
                  </div>

                  <section
                    class="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70"
                  >
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 class="text-sm font-semibold text-gray-900 dark:text-white">
                          专家发现状态
                        </h4>
                        <p class="text-xs text-gray-500 dark:text-slate-400">
                          轻量状态流，可见但不过度打扰
                        </p>
                      </div>
                      <button
                        type="button"
                        class="rounded-2xl bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-60"
                        :disabled="!draft.topic.trim() || isDiscovering"
                        @click="$emit('discover')"
                      >
                        {{ isDiscovering ? '生成中...' : '开始生成专家' }}
                      </button>
                    </div>

                    <div class="space-y-2">
                      <div
                        v-for="status in draft.discoveryStatus"
                        :key="status"
                        class="rounded-2xl border border-white/80 bg-white px-3 py-2 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                      >
                        {{ status }}
                      </div>
                      <div
                        v-if="!draft.discoveryStatus.length"
                        class="rounded-2xl border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-400 dark:border-slate-700 dark:text-slate-500"
                      >
                        等你点击“开始生成专家”后再启动发现流程。
                      </div>
                    </div>
                  </section>
                </section>
              </div>

              <div class="min-h-0 overflow-y-auto px-6 py-5">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 class="text-sm font-semibold text-gray-900 dark:text-white">候选专家</h4>
                    <p class="text-xs text-gray-500 dark:text-slate-400">
                      已选 {{ selectedCount }} 位 · 系统建议 {{ recommendedCount }} 位
                    </p>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-slate-400">知名度 + 专业度优先</div>
                </div>

                <div class="mb-4 flex gap-2">
                  <input
                    :value="draft.manualExpertName"
                    class="flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="手动追加真实专家"
                    @input="
                      $emit('update:manualExpertName', ($event.target as HTMLInputElement).value)
                    "
                    @keyup.enter="$emit('add-manual-expert')"
                  />
                  <button
                    type="button"
                    class="rounded-2xl border border-gray-200 px-4 py-3 text-sm dark:border-slate-700 dark:text-slate-200"
                    @click="$emit('add-manual-expert')"
                  >
                    追加
                  </button>
                </div>

                <div v-if="draft.candidates.length" class="space-y-3">
                  <ExpertCandidateCard
                    v-for="candidate in draft.candidates"
                    :key="candidate.id"
                    :candidate="candidate"
                    :selected="draft.selectedCandidateIds.includes(candidate.id)"
                    @toggle="$emit('toggle-candidate', candidate.id)"
                    @update:personaPrompt="
                      value =>
                        $emit('update:candidatePersonaPrompt', {
                          candidateId: candidate.id,
                          personaPrompt: value,
                        })
                    "
                    @regenerate="
                      extraNeed =>
                        $emit('regenerate-candidate-persona', {
                          candidateId: candidate.id,
                          extraNeed,
                        })
                    "
                  />
                </div>
                <div
                  v-else
                  class="rounded-2xl border border-dashed border-gray-200 p-5 text-sm text-gray-400 dark:border-slate-700 dark:text-slate-500"
                >
                  候选列表会在发现完成后展示。
                </div>
              </div>
            </div>

            <div class="border-t border-black/5 px-6 py-4 dark:border-white/10">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div v-if="lastRoom" class="text-xs text-gray-500 dark:text-slate-400">
                  上次会商：{{ lastRoom.topic }} · 第 {{ lastRoom.currentRound }} /
                  {{ lastRoom.maxRounds }} 轮
                </div>
                <div class="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    v-if="lastRoom"
                    type="button"
                    class="rounded-2xl border border-black/10 px-4 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-slate-200"
                    @click="$emit('resume-room')"
                  >
                    继续上次专家会商
                  </button>
                  <button
                    type="button"
                    class="rounded-2xl border border-black/10 px-4 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-slate-200"
                    @click="$emit('close')"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="rounded-2xl bg-primary-600 px-5 py-2.5 text-sm text-white disabled:opacity-50"
                    :disabled="selectedCount === 0"
                    @click="$emit('create-room')"
                  >
                    确认建房
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.group-chat-fade-enter-active,
.group-chat-fade-leave-active {
  transition: opacity 0.2s ease;
}

.group-chat-fade-enter-from,
.group-chat-fade-leave-to {
  opacity: 0;
}
</style>
