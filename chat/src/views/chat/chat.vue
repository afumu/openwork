<script setup lang="ts">
import BadWordsDialog from '@/components/Dialogs/BadWordsDialog.vue'
import Login from '@/components/Login/Login.vue'
import MobileSettingsDialog from '@/components/MobileSettingsDialog.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useAppStore, useAuthStore, useChatStore, useGlobalStoreWithOut } from '@/store'
import { message } from '@/utils/message'
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatBase from './chatBase.vue'
import {
  buildGroupRouteQuery,
  parseRouteGroupId,
  resolveActiveGroupId,
  shouldSyncActiveGroupToRoute,
} from './groupRoute'

const ms = message()
const appStore = useAppStore()
const chatStore = useChatStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const { isMobile } = useBasicLayout()
const isLogin = computed(() => authStore.isLogin)
const collapsed = computed(() => appStore.siderCollapsed)
const isApplyingRouteGroup = ref(false)
// const startX = ref(0)
// const endX = ref(0)

const isModelInherited = computed(() => Number(authStore.globalConfig?.isModelInherited) === 1)
const isStreamIn = computed(() => {
  return chatStore.isStreamIn !== undefined ? chatStore.isStreamIn : false
})

watch(isLogin, async (newVal, oldVal) => {
  if (newVal && !oldVal) {
    await chatStore.queryMyGroup({ preferredGroupId: parseRouteGroupId(route.query) })
    // 检查 URL 是否包含查询参数或哈希值
  }
})

async function replaceActiveGroupInRoute(activeGroupId: number) {
  if (!shouldSyncActiveGroupToRoute(activeGroupId, route.query)) return

  await router.replace({
    query: buildGroupRouteQuery(route.query, activeGroupId),
  })
}

async function applyRouteGroupId() {
  const routeGroupId = parseRouteGroupId(route.query)
  if (!routeGroupId || !chatStore.groupList.length) return

  const nextActiveGroupId = resolveActiveGroupId(
    chatStore.groupList,
    chatStore.active,
    routeGroupId
  )
  if (!nextActiveGroupId) return

  if (Number(chatStore.active) !== nextActiveGroupId) {
    isApplyingRouteGroup.value = true
    try {
      await chatStore.setActiveGroup(nextActiveGroupId)
    } finally {
      isApplyingRouteGroup.value = false
    }
  }

  await replaceActiveGroupInRoute(nextActiveGroupId)
}

watch(
  [() => route.query.groupId, () => chatStore.groupList.map(group => group.uuid).join(',')],
  () => {
    void applyRouteGroupId()
  },
  { flush: 'post' }
)

watch(
  () => chatStore.active,
  activeGroupId => {
    if (isApplyingRouteGroup.value) return
    void replaceActiveGroupInRoute(activeGroupId)
  },
  { flush: 'post' }
)

const getMobileClass = computed(() => {
  if (isMobile.value) return ['rounded-none', 'shadow-none']
  return ['rounded-none', 'shadow-md', 'dark:border-gray-900']
})

const getContainerClass = computed(() => {
  return [
    'h-full',
    'transition-[padding]',
    'duration-300',
    { 'pl-[260px]': !isMobile.value && !collapsed.value },
  ]
})

/* 新增一个对话 */
async function createNewChatGroup(groupType: Chat.GroupType = 'chat') {
  if (isStreamIn.value) {
    ms.info('AI回复中，请稍后再试')
    return
  }

  chatStore.setStreamIn(false)
  try {
    const { modelInfo } = chatStore.activeConfig
    const shouldInheritModelConfig =
      groupType === 'project' &&
      modelInfo &&
      isModelInherited.value &&
      chatStore.activeGroupAppId === 0

    if (shouldInheritModelConfig) {
      const config = {
        modelInfo,
      }
      await chatStore.addNewChatGroup(0, config, undefined, { groupType })
    } else {
      await chatStore.addNewChatGroup(0, undefined, undefined, { groupType })
    }
    chatStore.setUsingPlugin(null)

    if (isMobile.value) {
      appStore.setSiderCollapsed(true)
    }
  } catch (error) {}
}

// function handleTouchStart(event: any) {
//   startX.value = event.touches[0].clientX
// }

// function handleTouchEnd(event: any) {
//   endX.value = event.changedTouches[0].clientX
//   if (endX.value - startX.value > 100) {
//     if (isMobile.value) {
//       appStore.setSiderCollapsed(false)
//     }
//   }
// }

onMounted(() => {
  // 如果当前路径不是根路径，则重定向到根路径
  if (window.location.pathname !== '/' && !window.location.pathname.includes('.')) {
    window.history.replaceState({}, document.title, '/')
  }
})

const useGlobalStore = useGlobalStoreWithOut()
const loginDialog = computed(() => authStore.loginDialog)
const badWordsDialog = computed(() => useGlobalStore.BadWordsDialog)
const settingsDialog = computed(() => useGlobalStore.settingsDialog)
const mobileSettingsDialog = computed(() => useGlobalStore.mobileSettingsDialog)

provide('createNewChatGroup', createNewChatGroup)
</script>

<template>
  <div class="h-full transition-all">
    <div class="h-full overflow-hidden" :class="getMobileClass">
      <div class="z-40 h-full flex" :class="getContainerClass">
        <ChatBase class="w-full flex-1 transition-[margin] duration-500" />
      </div>
    </div>
    <div class="overflow-hidden">
      <Login :visible="loginDialog" />
      <BadWordsDialog :visible="badWordsDialog" />
      <SettingsDialog v-if="!isMobile" :visible="settingsDialog" />
      <MobileSettingsDialog v-else :visible="mobileSettingsDialog" />
    </div>
  </div>
</template>
