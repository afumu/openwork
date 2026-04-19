<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import {
  fetchPublishAccountListAPI,
  fetchWechatCoverCandidatesAPI,
  fetchWechatPublishAPI,
  fetchWechatPublishPreviewAPI,
  fetchWechatSyncDraftAPI,
  type PublishAccountItem,
  type PublishWechatCoverCandidatePayload,
  type PublishWechatPreviewPayload,
  type PublishWechatResultPayload,
} from '@/api/publishAccount'
import type { ResData } from '@/api/types'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useGlobalStoreWithOut } from '@/store'
import { DIALOG_TABS } from '@/store/modules/global'
import { message } from '@/utils/message'
import { MdEditor, MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import 'md-editor-v3/lib/preview.css'
import { computed, reactive, ref, watch } from 'vue'

interface Props {
  visible: boolean
  groupId: number
  path: string
  runId?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'published', payload: PublishWechatResultPayload): void
}>()

const ms = message()
const globalStore = useGlobalStoreWithOut()
const { isMobile } = useBasicLayout()

const initializing = ref(false)
const previewRefreshing = ref(false)
const coverLoading = ref(false)
const publishing = ref(false)
const syncing = ref(false)
const previewData = ref<PublishWechatPreviewPayload | null>(null)
const accounts = ref<PublishAccountItem[]>([])
const loadError = ref('')
const draftMarkdown = ref('')
const initialDraftMarkdown = ref('')
const titleTouched = ref(false)
const previewRequestToken = ref(0)

const themeOptions = [
  { value: 'default', label: '默认' },
  { value: 'orangeheart', label: 'Orange Heart' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'lapis', label: 'Lapis' },
  { value: 'pie', label: 'Pie' },
  { value: 'maize', label: 'Maize' },
  { value: 'purple', label: 'Purple' },
  { value: 'phycat', label: '物理猫-薄荷' },
  { value: 'juejin_default', label: '掘金默认' },
  { value: 'medium_default', label: 'Medium 默认' },
  { value: 'toutiao_default', label: '头条默认' },
  { value: 'zhihu_default', label: '知乎默认' },
]

const editorToolbarsExclude = [
  'save',
  'github',
  'catalog',
  'pageFullscreen',
  'fullscreen',
  'preview',
  'previewOnly',
  'htmlPreview',
]

const form = reactive({
  accountId: undefined as number | undefined,
  title: '',
  themeId: 'default',
  coverUrl: '',
  selectedCoverPath: '',
})

const selectedAccount = computed(
  () => accounts.value.find(item => item.id === form.accountId) || accounts.value[0] || null
)

const coverCandidates = computed(() => previewData.value?.coverSelection?.candidates || [])
const hasThemedPreviewHtml = computed(() => Boolean(previewData.value?.previewHtml?.trim()))
const isDraftDirty = computed(
  () =>
    draftMarkdown.value.trim() && draftMarkdown.value.trim() !== initialDraftMarkdown.value.trim()
)

const selectedCoverCandidate = computed<PublishWechatCoverCandidatePayload | null>(() => {
  if (!form.selectedCoverPath) return coverCandidates.value[0] || null
  return coverCandidates.value.find(item => item.relativePath === form.selectedCoverPath) || null
})

const resolvedCoverUrl = computed(() => {
  if (form.coverUrl.trim()) return form.coverUrl.trim()
  if (selectedCoverCandidate.value?.thumbnailUrl) return selectedCoverCandidate.value.thumbnailUrl
  if (selectedCoverCandidate.value?.imageUrl) return selectedCoverCandidate.value.imageUrl
  const markdown = previewData.value?.markdown || draftMarkdown.value || ''
  const match = markdown.match(/!\[[^\]]*]\((https?:\/\/[^)]+)\)/i)
  return match?.[1] || ''
})

function closeModal() {
  emit('close')
}

function openPublishAccounts() {
  closeModal()
  if (isMobile.value) {
    globalStore.updateMobileSettingsDialog(true, 'publish')
    return
  }

  globalStore.updateSettingsDialog(true, DIALOG_TABS.PUBLISH)
}

function applyPreviewData(
  nextPreview: PublishWechatPreviewPayload | null,
  options?: { resetDraft?: boolean }
) {
  const previousTitle = previewData.value?.title || ''
  previewData.value = nextPreview
  if (!nextPreview) return

  if (options?.resetDraft) {
    draftMarkdown.value = nextPreview.markdown || ''
    initialDraftMarkdown.value = nextPreview.markdown || ''
  }

  if (!titleTouched.value || !form.title.trim() || form.title === previousTitle) {
    form.title = nextPreview.title || ''
  }

  if (!form.selectedCoverPath) {
    form.selectedCoverPath = nextPreview.coverSelection?.selectedCoverPath || ''
  }
}

async function loadModalData() {
  if (!props.visible || !props.groupId || !props.path) return

  initializing.value = true
  loadError.value = ''
  titleTouched.value = false

  try {
    const [accountRes, previewRes] = await Promise.all([
      fetchPublishAccountListAPI(),
      fetchWechatPublishPreviewAPI({
        groupId: props.groupId,
        runId: props.runId || undefined,
        path: props.path,
        themeId: form.themeId,
      }),
    ])

    const accountData = ((accountRes as ResData).data || []) as PublishAccountItem[]
    const nextPreview = ((previewRes as ResData).data || null) as PublishWechatPreviewPayload | null

    accounts.value = Array.isArray(accountData) ? accountData : []
    applyPreviewData(nextPreview, { resetDraft: true })

    const defaultAccount = accountData.find(item => item.isDefault) || accountData[0]
    form.accountId = defaultAccount?.id
    form.themeId = nextPreview?.themeId || 'default'
    form.coverUrl = ''
    form.selectedCoverPath = nextPreview?.coverSelection?.selectedCoverPath || ''

    void loadCoverCandidates(false)
  } catch (error: any) {
    loadError.value = error?.message || '公众号预览加载失败'
  } finally {
    initializing.value = false
  }
}

async function loadCoverCandidates(refreshCover: boolean) {
  try {
    coverLoading.value = true
    const coverRes = (await fetchWechatCoverCandidatesAPI({
      groupId: props.groupId,
      runId: props.runId || undefined,
      path: props.path,
      refreshCover,
      markdown: draftMarkdown.value.trim() || undefined,
    })) as ResData

    if (!previewData.value) return
    previewData.value = {
      ...previewData.value,
      coverSelection: coverRes.data,
    }

    if (!form.coverUrl.trim()) {
      form.selectedCoverPath = coverRes?.data?.selectedCoverPath || form.selectedCoverPath
    }
  } catch (error: any) {
    if (refreshCover) {
      ms.warning(error?.message || '封面候选加载失败')
    }
  } finally {
    coverLoading.value = false
  }
}

async function refreshPreview(options?: { silent?: boolean }) {
  const trimmedDraft = draftMarkdown.value.trim()
  if (!trimmedDraft) {
    if (!options?.silent) {
      ms.warning('请先填写发布工作副本内容')
    }
    return
  }

  const requestToken = ++previewRequestToken.value
  previewRefreshing.value = true
  if (!options?.silent) {
    loadError.value = ''
  }

  try {
    const previewRes = (await fetchWechatPublishPreviewAPI({
      groupId: props.groupId,
      runId: props.runId || undefined,
      path: props.path,
      themeId: form.themeId,
      markdown: trimmedDraft,
    })) as ResData

    if (requestToken !== previewRequestToken.value) return
    applyPreviewData(previewRes.data)
  } catch (error: any) {
    if (!options?.silent) {
      loadError.value = error?.message || '公众号预览刷新失败'
    }
  } finally {
    if (requestToken === previewRequestToken.value) {
      previewRefreshing.value = false
    }
  }
}

const debouncedRefreshPreview = useDebounceFn(() => {
  if (!props.visible || !previewData.value) return
  void refreshPreview({ silent: true })
}, 500)

async function refreshCoverCandidates() {
  loadError.value = ''
  await loadCoverCandidates(true)
}

async function syncDraftToArtifact() {
  const trimmedDraft = draftMarkdown.value.trim()
  if (!trimmedDraft) {
    ms.warning('请先填写发布工作副本内容')
    return
  }

  syncing.value = true
  try {
    await fetchWechatSyncDraftAPI({
      groupId: props.groupId,
      runId: props.runId || undefined,
      path: props.path,
      markdown: trimmedDraft,
    })

    initialDraftMarkdown.value = trimmedDraft
    ms.success('已同步回原稿')
  } finally {
    syncing.value = false
  }
}

async function publishArticle() {
  if (!previewData.value) {
    ms.warning('预览尚未准备完成')
    return
  }
  if (!accounts.value.length) {
    ms.warning('请先配置公众号发布账号')
    return
  }
  if (!draftMarkdown.value.trim()) {
    ms.warning('请先填写发布工作副本内容')
    return
  }
  if (!form.title.trim()) {
    ms.warning('请输入发布标题')
    return
  }
  if (!form.coverUrl.trim() && !form.selectedCoverPath) {
    ms.warning('请先选择封面图，或手动填写封面图 URL')
    return
  }

  publishing.value = true
  try {
    const res = (await fetchWechatPublishAPI({
      groupId: props.groupId,
      runId: props.runId || undefined,
      path: props.path,
      accountId: form.accountId,
      title: form.title.trim(),
      themeId: form.themeId.trim() || 'default',
      markdown: draftMarkdown.value.trim(),
      coverUrl: form.coverUrl.trim() || undefined,
      selectedCoverPath: form.coverUrl.trim() ? undefined : form.selectedCoverPath || undefined,
    })) as ResData

    ms.success(`已发布到草稿箱，media_id：${res.data.mediaId}`)
    emit('published', res.data)
    closeModal()
  } finally {
    publishing.value = false
  }
}

function onTitleInput(value: string) {
  form.title = value
  titleTouched.value = true
}

watch(
  () => props.visible,
  visible => {
    if (visible) {
      void loadModalData()
    } else {
      loadError.value = ''
      previewData.value = null
      accounts.value = []
      coverLoading.value = false
      previewRefreshing.value = false
      draftMarkdown.value = ''
      initialDraftMarkdown.value = ''
      form.selectedCoverPath = ''
      form.coverUrl = ''
      form.title = ''
      titleTouched.value = false
    }
  }
)

watch(
  () => draftMarkdown.value,
  (value, previousValue) => {
    if (!props.visible || !previewData.value || value === previousValue) return
    debouncedRefreshPreview()
  }
)

watch(
  () => form.themeId,
  (themeId, previousThemeId) => {
    if (!props.visible || !previewData.value || !previousThemeId || themeId === previousThemeId)
      return
    debouncedRefreshPreview()
  }
)
</script>

<template>
  <transition name="wechat-publish-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[9100] flex items-center justify-center bg-gray-900 bg-opacity-50"
      :class="isMobile ? 'p-0' : 'p-4'"
      @click.self="closeModal"
    >
      <div
        class="bg-white dark:bg-gray-750 shadow-lg flex flex-col overflow-hidden"
        :class="isMobile ? 'w-full h-full' : 'w-full max-w-[1400px] h-[88vh] rounded-lg'"
      >
        <div
          class="flex justify-between items-center px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-600"
        >
          <div>
            <div class="text-xl font-semibold text-gray-900 dark:text-white">发布到公众号</div>
            <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              左边修改发布工作副本，右边直接查看公众号效果。
            </div>
          </div>
          <button class="btn-icon btn-md" @click="closeModal">×</button>
        </div>

        <div class="flex-1 min-h-0 overflow-hidden p-4 flex flex-col gap-4">
          <section
            class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 shadow-sm p-4"
          >
            <div
              v-if="initializing && !previewData"
              class="text-sm text-gray-500 dark:text-gray-400"
            >
              正在准备发布工作台...
            </div>

            <div
              v-else-if="loadError && !previewData"
              class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-500 dark:text-red-300"
            >
              {{ loadError }}
            </div>

            <div v-else class="flex flex-col gap-4">
              <div
                class="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1.3fr)_220px_minmax(0,1fr)]"
              >
                <div class="flex flex-col space-y-1">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    发布账号
                  </label>
                  <select
                    v-model="form.accountId"
                    class="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-750 px-3 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <option v-for="account in accounts" :key="account.id" :value="account.id">
                      {{ account.accountName }}{{ account.isDefault ? '（默认）' : '' }}
                    </option>
                  </select>
                </div>

                <div class="flex flex-col space-y-1">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    发布标题
                  </label>
                  <input
                    :value="form.title"
                    class="input input-md w-full"
                    type="text"
                    placeholder="请输入发布标题"
                    @input="onTitleInput(($event.target as HTMLInputElement).value)"
                  />
                </div>

                <div class="flex flex-col space-y-1">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    主题 ID
                  </label>
                  <select
                    v-model="form.themeId"
                    class="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-750 px-3 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <option v-for="theme in themeOptions" :key="theme.value" :value="theme.value">
                      {{ theme.label }}（{{ theme.value }}）
                    </option>
                  </select>
                </div>

                <div class="flex flex-col space-y-1">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    封面图 URL
                  </label>
                  <input
                    v-model="form.coverUrl"
                    class="input input-md w-full"
                    type="text"
                    placeholder="可选，支持 http/https 图片地址"
                  />
                </div>
              </div>

              <div
                v-if="!accounts.length"
                class="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-200"
              >
                <div>当前还没有可用的公众号账号。</div>
                <button class="btn btn-secondary btn-sm mt-3" @click="openPublishAccounts">
                  去配置发布账号
                </button>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs text-gray-500 dark:text-gray-400 break-all">
                  当前稿件：<code>{{ path }}</code>
                  <span v-if="previewRefreshing" class="ml-2">正在根据工作副本刷新预览...</span>
                  <span v-else-if="isDraftDirty" class="ml-2 text-amber-500 dark:text-amber-300">
                    当前改动尚未同步回原稿
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="btn btn-secondary btn-md"
                    :disabled="coverLoading || !draftMarkdown.trim()"
                    @click="refreshCoverCandidates"
                  >
                    {{ coverLoading ? '搜索中...' : '重新搜封面' }}
                  </button>
                  <button
                    class="btn btn-secondary btn-md"
                    :disabled="previewRefreshing || !draftMarkdown.trim()"
                    @click="refreshPreview()"
                  >
                    刷新预览
                  </button>
                  <button
                    class="btn btn-secondary btn-md"
                    :disabled="syncing || !isDraftDirty"
                    @click="syncDraftToArtifact"
                  >
                    {{ syncing ? '同步中...' : '同步回原稿' }}
                  </button>
                  <button
                    class="btn btn-primary btn-md"
                    :disabled="publishing || previewRefreshing || !accounts.length"
                    @click="publishArticle"
                  >
                    {{ publishing ? '发布中...' : '发布到草稿箱' }}
                  </button>
                </div>
              </div>

              <div
                v-if="loadError && previewData"
                class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-500 dark:text-red-300"
              >
                {{ loadError }}
              </div>
            </div>
          </section>

          <div
            class="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4"
          >
            <section
              class="min-h-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 shadow-sm overflow-hidden flex flex-col"
            >
              <div
                class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700"
              >
                <div class="text-base font-semibold text-gray-900 dark:text-gray-100">
                  发布工作副本
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  仅影响这次预览和发布，除非你点“同步回原稿”
                </div>
              </div>

              <div class="min-h-0 flex-1">
                <MdEditor
                  v-model="draftMarkdown"
                  class="wechat-draft-editor h-full"
                  editor-id="wechat-publish-draft-editor"
                  language="zh-CN"
                  preview-theme="github"
                  theme="light"
                  :preview="false"
                  :toolbars-exclude="editorToolbarsExclude"
                />
              </div>
            </section>

            <section
              class="min-h-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 shadow-sm overflow-hidden flex flex-col"
            >
              <div
                class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700"
              >
                <div class="text-base font-semibold text-gray-900 dark:text-gray-100">
                  公众号预览
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  右侧会按当前主题和工作副本自动刷新
                </div>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
                      自动封面候选
                    </label>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{
                        coverLoading
                          ? '正在搜索...'
                          : previewData?.coverSelection?.fromCache
                            ? '已命中缓存'
                            : '基于当前工作副本'
                      }}
                    </span>
                  </div>

                  <div
                    v-if="previewData?.coverSelection?.queries?.length"
                    class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 px-4 py-3 text-xs text-gray-500 dark:text-gray-400"
                  >
                    搜索词：{{ previewData.coverSelection.queries.join(' / ') }}
                  </div>

                  <div v-if="coverCandidates.length" class="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <button
                      v-for="candidate in coverCandidates"
                      :key="candidate.id"
                      type="button"
                      class="text-left rounded-lg border overflow-hidden transition-colors"
                      :class="
                        form.selectedCoverPath === candidate.relativePath
                          ? 'border-green-500 ring-1 ring-green-200 dark:ring-green-900/40'
                          : 'border-gray-200 dark:border-gray-600 hover:border-green-300'
                      "
                      @click="form.selectedCoverPath = candidate.relativePath"
                    >
                      <img
                        class="block h-24 w-full object-cover bg-gray-100 dark:bg-gray-700"
                        :src="candidate.thumbnailUrl || candidate.imageUrl"
                        :alt="candidate.title"
                      />
                      <div class="p-3">
                        <div
                          class="line-clamp-2 text-xs font-medium text-gray-800 dark:text-gray-100"
                        >
                          {{ candidate.title || '未命名封面' }}
                        </div>
                        <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                          {{ candidate.creator || '未知作者' }}
                        </div>
                      </div>
                    </button>
                  </div>

                  <div
                    v-else
                    class="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
                  >
                    {{
                      coverLoading
                        ? '正在搜索封面候选，请稍候...'
                        : '暂未搜到可用封面，请手动填写封面图 URL，或稍后重新搜索。'
                    }}
                  </div>
                </div>

                <div v-if="previewData" class="flex justify-center">
                  <div
                    class="wechat-preview-surface w-full max-w-[560px] rounded-[24px] border border-gray-200 bg-white shadow-sm overflow-hidden"
                  >
                    <div
                      class="px-6 pt-6 pb-3 text-[28px] font-semibold leading-[1.35] text-gray-900"
                    >
                      {{ form.title || previewData.title }}
                    </div>
                    <div class="px-6 pb-4 text-sm text-gray-500 flex gap-3">
                      <span>{{ selectedAccount?.accountName || '未选择账号' }}</span>
                      <span>今天</span>
                    </div>
                    <img
                      v-if="resolvedCoverUrl"
                      class="block w-[calc(100%-48px)] h-[220px] mx-6 mb-5 rounded-[18px] object-cover"
                      :src="resolvedCoverUrl"
                      alt="封面图"
                    />
                    <div
                      v-if="hasThemedPreviewHtml"
                      class="wechat-md-preview px-4 pb-6"
                      v-html="previewData.previewHtml || ''"
                    />
                    <div v-else class="wechat-md-preview px-4 pb-6">
                      <MdPreview
                        editor-id="wechat-publish-preview-fallback"
                        :model-value="previewData.markdown || draftMarkdown"
                        theme="light"
                        preview-theme="github"
                      />
                    </div>
                  </div>
                </div>

                <div
                  v-else
                  class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
                >
                  暂无可预览内容
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.wechat-draft-editor :deep(.md-editor) {
  height: 100%;
  border: none;
}

.wechat-draft-editor :deep(.md-editor-toolbar-wrapper) {
  border-bottom: 1px solid rgba(229, 231, 235, 1);
}

.wechat-draft-editor :deep(.md-editor-content) {
  height: calc(100% - 48px);
}

.wechat-draft-editor :deep(.cm-editor) {
  min-height: 100%;
}

.wechat-md-preview :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.wechat-md-preview :deep(#wenyan) {
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  color: #111827;
}

.wechat-md-preview :deep(.github-theme) {
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  color: #111827;
}

.wechat-md-preview :deep(ul),
.wechat-md-preview :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.wechat-md-preview :deep(ul) {
  list-style: disc;
}

.wechat-md-preview :deep(ol) {
  list-style: decimal;
}

.wechat-md-preview :deep(li) {
  margin: 0.35rem 0;
  display: list-item;
}

.wechat-md-preview :deep(h1),
.wechat-md-preview :deep(h2),
.wechat-md-preview :deep(h3) {
  border-bottom: none;
}

.wechat-publish-fade-enter-active,
.wechat-publish-fade-leave-active {
  transition: opacity 0.24s ease;
}

.wechat-publish-fade-enter-from,
.wechat-publish-fade-leave-to {
  opacity: 0;
}
</style>
