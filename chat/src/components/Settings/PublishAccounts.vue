<script setup lang="ts">
import {
  fetchCreatePublishAccountAPI,
  fetchDeletePublishAccountAPI,
  fetchPublishAccountListAPI,
  fetchRevealPublishAccountSecretAPI,
  fetchSetDefaultPublishAccountAPI,
  fetchTestPublishAccountAPI,
  fetchUpdatePublishAccountAPI,
  type PublishAccountItem,
  type PublishAccountSecretPayload,
} from '@/api/publishAccount'
import type { ResData } from '@/api/types'
import { useAuthStore, useGlobalStoreWithOut } from '@/store'
import { message } from '@/utils/message'
import { dialog } from '@/utils/dialog'
import { computed, reactive, ref, watch } from 'vue'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const authStore = useAuthStore()
const globalStore = useGlobalStoreWithOut()
const ms = message()

const loading = ref(false)
const saving = ref(false)
const accounts = ref<PublishAccountItem[]>([])
const testingId = ref<number | null>(null)
const actionId = ref<number | null>(null)
const showEditor = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const revealedSecrets = ref<Record<number, PublishAccountSecretPayload>>({})

const editorForm = reactive({
  id: 0,
  accountName: '',
  wechatAppId: '',
  wechatAppSecret: '',
  isDefault: false,
})

const isLogin = computed(() => authStore.isLogin)

function checkLoginStatus() {
  if (isLogin.value) return true

  ms.warning('请先登录后再管理发布账号')
  globalStore.updateSettingsDialog(false)
  authStore.setLoginDialog(true)
  return false
}

function resetEditor() {
  editorForm.id = 0
  editorForm.accountName = ''
  editorForm.wechatAppId = ''
  editorForm.wechatAppSecret = ''
  editorForm.isDefault = accounts.value.length === 0
}

function openCreateEditor() {
  resetEditor()
  editorMode.value = 'create'
  showEditor.value = true
}

function openEditEditor(account: PublishAccountItem) {
  editorMode.value = 'edit'
  showEditor.value = true
  editorForm.id = account.id
  editorForm.accountName = account.accountName
  editorForm.wechatAppId = account.wechatAppId
  editorForm.wechatAppSecret = ''
  editorForm.isDefault = account.isDefault
}

function closeEditor() {
  showEditor.value = false
  resetEditor()
}

function formatTime(value?: string | null) {
  if (!value) return '暂未记录'

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch (_error) {
    return value
  }
}

function resolveTestStatusText(account: PublishAccountItem) {
  if (account.lastTestStatus === 'success') return '连接正常'
  if (account.lastTestStatus === 'failed') return account.lastTestMessage || '连接失败'
  return '尚未测试'
}

async function loadAccounts() {
  if (!checkLoginStatus()) return

  loading.value = true
  try {
    const res = (await fetchPublishAccountListAPI()) as ResData
    accounts.value = Array.isArray(res.data) ? res.data : []
    if (!showEditor.value && accounts.value.length === 0) {
      resetEditor()
    }
  } finally {
    loading.value = false
  }
}

function validateEditor() {
  if (!editorForm.accountName.trim()) {
    ms.warning('请输入公众号名称')
    return false
  }

  if (!editorForm.wechatAppId.trim()) {
    ms.warning('请输入 AppId')
    return false
  }

  if (editorMode.value === 'create' && !editorForm.wechatAppSecret.trim()) {
    ms.warning('请输入 AppSecret')
    return false
  }

  return true
}

async function submitEditor() {
  if (!validateEditor()) return

  saving.value = true
  try {
    if (editorMode.value === 'create') {
      await fetchCreatePublishAccountAPI({
        accountName: editorForm.accountName.trim(),
        wechatAppId: editorForm.wechatAppId.trim(),
        wechatAppSecret: editorForm.wechatAppSecret.trim(),
        isDefault: editorForm.isDefault,
      })
      ms.success('公众号账号已添加')
    } else {
      const payload: Record<string, any> = {
        id: editorForm.id,
        accountName: editorForm.accountName.trim(),
        wechatAppId: editorForm.wechatAppId.trim(),
        isDefault: editorForm.isDefault,
      }

      if (editorForm.wechatAppSecret.trim()) {
        payload.wechatAppSecret = editorForm.wechatAppSecret.trim()
      }

      await fetchUpdatePublishAccountAPI(payload)
      delete revealedSecrets.value[editorForm.id]
      ms.success('公众号账号已更新')
    }

    closeEditor()
    await loadAccounts()
  } finally {
    saving.value = false
  }
}

async function handleSetDefault(account: PublishAccountItem) {
  if (account.isDefault) return

  actionId.value = account.id
  try {
    await fetchSetDefaultPublishAccountAPI({ id: account.id })
    ms.success('已切换默认账号')
    await loadAccounts()
  } finally {
    actionId.value = null
  }
}

async function handleTest(account: PublishAccountItem) {
  testingId.value = account.id
  try {
    const res = (await fetchTestPublishAccountAPI({ id: account.id })) as ResData
    ms.success(res?.data?.message || '连接测试完成')
    await loadAccounts()
  } finally {
    testingId.value = null
  }
}

function handleDelete(account: PublishAccountItem) {
  const dialogInstance = dialog()
  dialogInstance.warning({
    title: '删除发布账号',
    content: `确定删除“${account.accountName}”吗？删除后将无法继续使用该公众号发稿。`,
    positiveText: '删除',
    negativeText: '取消',
    async onPositiveClick() {
      actionId.value = account.id
      try {
        await fetchDeletePublishAccountAPI({ id: account.id })
        delete revealedSecrets.value[account.id]
        ms.success('公众号账号已删除')
        await loadAccounts()
      } finally {
        actionId.value = null
      }
    },
  })
}

function handleReveal(account: PublishAccountItem) {
  if (revealedSecrets.value[account.id]) {
    delete revealedSecrets.value[account.id]
    return
  }

  const dialogInstance = dialog()
  dialogInstance.warning({
    title: '查看明文密钥',
    content: `将显示“${account.accountName}”的 AppSecret 明文，请确认当前环境安全。`,
    positiveText: '继续查看',
    negativeText: '取消',
    async onPositiveClick() {
      actionId.value = account.id
      try {
        const res = (await fetchRevealPublishAccountSecretAPI({ id: account.id })) as ResData
        revealedSecrets.value = {
          ...revealedSecrets.value,
          [account.id]: res.data,
        }
        ms.success('已显示明文密钥')
      } finally {
        actionId.value = null
      }
    },
  })
}

watch(
  () => props.visible,
  visible => {
    if (visible) {
      void loadAccounts()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="overflow-y-auto custom-scrollbar p-1">
    <div
      class="p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-4 flex flex-col space-y-4"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div
            class="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2 pb-2 border-b border-gray-200 dark:border-gray-700"
          >
            发布账号
          </div>
          <div class="text-sm text-gray-500 dark:text-gray-400 leading-6">
            在这里管理你自己的公众号账号。发布正式稿时，会优先选择默认账号。
          </div>
        </div>
        <button class="btn btn-primary btn-md whitespace-nowrap" @click="openCreateEditor">
          新增公众号账号
        </button>
      </div>

      <div
        class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 px-4 py-3 text-sm text-gray-600 dark:text-gray-300"
      >
        只需要填写 <code class="text-xs">AppId</code> 和
        <code class="text-xs">AppSecret</code>。保存后默认掩码展示，需要时可手动查看明文。
      </div>
    </div>

    <div
      v-if="showEditor"
      class="p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-4 flex flex-col space-y-4"
    >
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between pb-2 border-b border-gray-200 dark:border-gray-700"
      >
        <div>
          <div class="text-base font-semibold text-gray-900 dark:text-gray-100">
            {{ editorMode === 'create' ? '新增公众号账号' : '编辑公众号账号' }}
          </div>
          <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{
              editorMode === 'create' ? '新增后可用于草稿发布。' : 'AppSecret 留空表示保持不变。'
            }}
          </div>
        </div>
        <button class="btn btn-secondary btn-md" @click="closeEditor">取消</button>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="flex flex-col space-y-1">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">公众号名称</label>
          <input
            v-model="editorForm.accountName"
            class="input input-md w-full"
            type="text"
            placeholder="例如：AI 前沿观察"
          />
        </div>

        <div class="flex flex-col space-y-1">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">AppId</label>
          <input
            v-model="editorForm.wechatAppId"
            class="input input-md w-full"
            type="text"
            placeholder="wx1234567890"
          />
        </div>

        <div class="flex flex-col space-y-1 md:col-span-2">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">AppSecret</label>
          <input
            v-model="editorForm.wechatAppSecret"
            class="input input-md w-full"
            type="text"
            :placeholder="
              editorMode === 'create' ? '请输入公众号 AppSecret' : '留空则保持当前 AppSecret'
            "
          />
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input v-model="editorForm.isDefault" type="checkbox" class="rounded border-gray-300" />
        <span>设为默认发布账号</span>
      </label>

      <div class="flex justify-end">
        <button class="btn btn-primary btn-md" :disabled="saving" @click="submitEditor">
          {{ saving ? '保存中...' : editorMode === 'create' ? '保存账号' : '更新账号' }}
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-4 text-sm text-gray-500 dark:text-gray-400"
    >
      正在加载公众号账号...
    </div>

    <template v-else>
      <div
        v-if="accounts.length === 0"
        class="p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-4 flex flex-col space-y-3"
      >
        <div class="text-base font-semibold text-gray-900 dark:text-gray-100">
          还没有可用的发布账号
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400 leading-6">
          先添加一个公众号账号，之后在稿件预览里就可以直接发布到草稿箱。
        </div>
      </div>

      <div class="space-y-4">
        <article
          v-for="account in accounts"
          :key="account.id"
          class="p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm border mb-4 flex flex-col space-y-4"
          :class="
            account.isDefault
              ? 'border-primary-300 dark:border-primary-500'
              : 'border-gray-200 dark:border-gray-700'
          "
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {{ account.accountName }}
                </div>
                <span
                  v-if="account.isDefault"
                  class="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600 dark:bg-primary-900/30 dark:text-primary-300"
                >
                  默认账号
                </span>
              </div>
              <div class="mt-1 text-sm text-gray-500 dark:text-gray-400 break-all">
                AppId：{{ account.wechatAppId }}
              </div>
            </div>

            <button
              v-if="!account.isDefault"
              class="btn btn-secondary btn-sm"
              :disabled="actionId === account.id"
              @click="handleSetDefault(account)"
            >
              设为默认
            </button>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div
              class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 p-3"
            >
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">AppSecret</div>
              <code class="block text-xs leading-5 break-all text-gray-700 dark:text-gray-200">
                {{ revealedSecrets[account.id]?.wechatAppSecret || account.wechatAppSecretMasked }}
              </code>
            </div>

            <div
              class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 p-3"
            >
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">连接状态</div>
              <span
                class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                :class="
                  account.lastTestStatus === 'success'
                    ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                    : account.lastTestStatus === 'failed'
                      ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                "
              >
                {{ resolveTestStatusText(account) }}
              </span>
            </div>

            <div
              class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750 p-3"
            >
              <div class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">最近发布</div>
              <div class="text-sm text-gray-700 dark:text-gray-200">
                {{ formatTime(account.lastPublishedAt) }}
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              最近更新：{{ formatTime(account.updatedAt) }}
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                class="btn btn-secondary btn-sm"
                :disabled="actionId === account.id"
                @click="handleReveal(account)"
              >
                {{ revealedSecrets[account.id] ? '隐藏明文' : '查看明文' }}
              </button>
              <button
                class="btn btn-secondary btn-sm"
                :disabled="testingId === account.id"
                @click="handleTest(account)"
              >
                {{ testingId === account.id ? '测试中...' : '测试连接' }}
              </button>
              <button class="btn btn-secondary btn-sm" @click="openEditEditor(account)">
                编辑
              </button>
              <button
                class="inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="actionId === account.id"
                @click="handleDelete(account)"
              >
                删除
              </button>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
