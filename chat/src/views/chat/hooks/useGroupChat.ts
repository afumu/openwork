import { computed, ref, watch } from 'vue'
import { getToken } from '@/store/modules/auth/helper'
import {
  createJoinNotice,
  createManualExpert,
  createParticipants,
  createSummaryMessage,
  planLiveResponders,
  regeneratePersonaPrompt,
} from '../components/group-chat/mock'
import type {
  DiscussionMessage,
  DiscussionParticipant,
  DiscussionRoom,
  GroupChatDraft,
  GroupChatStorageState,
} from '../components/group-chat/types'
import { createId, sleep } from '../components/group-chat/utils'

const STORAGE_KEY = 'openwork-group-chat-state-v1'

type GroupChatDependencies = {
  discoverExperts?: (params: { topic: string; limit?: number }) => Promise<{
    data?: {
      candidates?: GroupChatDraft['candidates']
      meta?: {
        queries?: string[]
        resultCount?: number
        extractionMode?: 'model' | 'fallback' | 'empty'
      }
    }
  }>
  generateDiscussionTurn?: (params: {
    roomId?: string
    topic: string
    topicContext?: string
    goal?: string
    responseLength: DiscussionRoom['responseLength']
    currentRound: number
    maxRounds: number
    initial?: boolean
    prompt?: string
    participants: DiscussionParticipant[]
    messages: Array<
      Pick<
        DiscussionMessage,
        'participantId' | 'participantType' | 'messageType' | 'content' | 'roundIndex'
      >
    >
  }) => Promise<{
    data?: {
      nextRound?: number
      messages?: Array<
        Pick<
          DiscussionMessage,
          'participantId' | 'participantType' | 'messageType' | 'content' | 'targetParticipantIds'
        >
      >
      meta?: {
        queries?: string[]
        resultCount?: number
        generationMode?: 'model' | 'fallback'
      }
    }
  }>
}

function createEmptyDraft(topic = ''): GroupChatDraft {
  const now = new Date().toISOString()
  return {
    id: createId('draft'),
    topic,
    topicContext: '',
    goal: '',
    responseLength: 'balanced',
    maxRounds: 4,
    status: topic ? 'drafting' : 'idle',
    discoveryStatus: [],
    candidates: [],
    selectedCandidateIds: [],
    manualExpertName: '',
    createdAt: now,
    updatedAt: now,
  }
}

function readStorage(): GroupChatStorageState {
  if (typeof window === 'undefined') {
    return {
      draft: null,
      rooms: [],
      lastRoomId: null,
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        draft: null,
        rooms: [],
        lastRoomId: null,
      }
    }

    const parsed = JSON.parse(raw) as GroupChatStorageState
    const draft = parsed.draft
      ? {
          ...createEmptyDraft(parsed.draft.topic || ''),
          ...parsed.draft,
          responseLength: parsed.draft.responseLength || 'balanced',
          candidates: (parsed.draft.candidates || []).map(candidate => ({
            ...candidate,
            personaPrompt:
              candidate.personaPrompt ||
              regeneratePersonaPrompt({
                name: candidate.name,
                identity: candidate.identity,
                organization: candidate.organization,
                expertise: candidate.expertise,
                perspective: candidate.perspective,
                stance: candidate.stance,
                topic: parsed.draft?.topic || '',
                goal: parsed.draft?.goal || '',
                isManual: candidate.isManual,
              }),
          })),
        }
      : null

    return {
      draft,
      rooms: (parsed.rooms || []).map(room => ({
        ...room,
        responseLength: room.responseLength || 'balanced',
        liveResponders: [],
        participants: (room.participants || []).map(participant => ({
          ...participant,
          personaPrompt:
            participant.personaPrompt ||
            (participant.participantType === 'user'
              ? undefined
              : regeneratePersonaPrompt({
                  name: participant.displayName,
                  identity: participant.roleSummary.split(' · ')[0] || participant.roleSummary,
                  organization: participant.organization || 'Unknown',
                  expertise: participant.perspective ? [participant.perspective] : ['主题相关观察'],
                  perspective: participant.perspective || '待确认',
                  stance: participant.stance || '审慎中立',
                  topic: room.topic,
                  goal: room.goal,
                  isManual: participant.isManual,
                })),
        })),
      })),
      lastRoomId: parsed.lastRoomId || null,
    }
  } catch (error) {
    return {
      draft: null,
      rooms: [],
      lastRoomId: null,
    }
  }
}

export function useGroupChat(deps: GroupChatDependencies = {}) {
  const storageState = readStorage()

  const builderVisible = ref(false)
  const roomVisible = ref(false)
  const isDiscovering = ref(false)
  const discoveryRunId = ref(0)
  const pendingAdvanceTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const discussionRunId = ref(0)
  const activeDraft = ref<GroupChatDraft>(storageState.draft || createEmptyDraft())
  const rooms = ref<DiscussionRoom[]>(storageState.rooms || [])
  const currentRoomId = ref<string | null>(storageState.lastRoomId)

  const activeRoom = computed(
    () => rooms.value.find(item => item.id === currentRoomId.value) || null
  )

  const lastRoom = computed(
    () => rooms.value.find(item => item.id === currentRoomId.value) || rooms.value[0] || null
  )

  const discoverExpertsRequest =
    deps.discoverExperts ||
    (async (params: { topic: string; limit?: number }) => {
      const { fetchDiscoverExpertsAPI } = await import('@/api/groupChat')
      return fetchDiscoverExpertsAPI<{ candidates: GroupChatDraft['candidates'] }>(params)
    })

  const generateDiscussionTurnRequest =
    deps.generateDiscussionTurn ||
    (async (params: {
      roomId?: string
      topic: string
      topicContext?: string
      goal?: string
      responseLength: DiscussionRoom['responseLength']
      currentRound: number
      maxRounds: number
      initial?: boolean
      prompt?: string
      participants: DiscussionParticipant[]
      messages: Array<
        Pick<
          DiscussionMessage,
          'participantId' | 'participantType' | 'messageType' | 'content' | 'roundIndex'
        >
      >
    }) => {
      const { fetchDiscussionTurnAPI } = await import('@/api/groupChat')
      return fetchDiscussionTurnAPI(params)
    })

  function persistState() {
    if (typeof window === 'undefined') return
    const payload: GroupChatStorageState = {
      draft: activeDraft.value,
      rooms: rooms.value,
      lastRoomId: currentRoomId.value,
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.warn('[group-chat] persist state failed', error)
    }
  }

  watch([activeDraft, rooms, currentRoomId], persistState, { deep: true })

  function clearPendingAdvance() {
    if (pendingAdvanceTimer.value) {
      clearTimeout(pendingAdvanceTimer.value)
      pendingAdvanceTimer.value = null
    }
  }

  function nextDiscussionRunId() {
    discussionRunId.value += 1
    return discussionRunId.value
  }

  function openBuilder(initialTopic = '') {
    clearPendingAdvance()
    nextDiscussionRunId()
    builderVisible.value = true
    roomVisible.value = false

    if (initialTopic && initialTopic !== activeDraft.value.topic) {
      activeDraft.value = createEmptyDraft(initialTopic)
    } else if (!activeDraft.value.topic) {
      activeDraft.value = createEmptyDraft(initialTopic)
    }
  }

  function closeBuilder() {
    builderVisible.value = false
  }

  function updateDraftField(field: keyof GroupChatDraft, value: string | number | string[]) {
    activeDraft.value = {
      ...activeDraft.value,
      [field]: value,
      status: activeDraft.value.status === 'idle' ? 'drafting' : activeDraft.value.status,
      updatedAt: new Date().toISOString(),
    }
  }

  async function startDiscoverExperts() {
    if (!activeDraft.value.topic.trim() || isDiscovering.value) return
    if (!deps.discoverExperts && !getToken()) {
      activeDraft.value.discoveryStatus = ['请先登录后再生成专家']
      activeDraft.value.status = 'drafting'
      activeDraft.value.updatedAt = new Date().toISOString()
      void import('@/store').then(({ useAuthStore }) => {
        useAuthStore().setLoginDialog(true)
      })
      return
    }

    const runId = discoveryRunId.value + 1
    discoveryRunId.value = runId
    isDiscovering.value = true
    activeDraft.value.status = 'discovering_experts'
    activeDraft.value.discoveryStatus = ['正在发现全球范围内的真实专家']
    activeDraft.value.updatedAt = new Date().toISOString()

    await sleep(320)
    if (discoveryRunId.value !== runId) return
    activeDraft.value.discoveryStatus = [
      '正在发现全球范围内的真实专家',
      '已匹配公开资料与长期代表性人物',
    ]

    await sleep(320)
    if (discoveryRunId.value !== runId) return
    activeDraft.value.discoveryStatus = [
      '正在发现全球范围内的真实专家',
      '已匹配公开资料与长期代表性人物',
      '正在完成专业视角与立场倾向分类',
    ]

    try {
      const response = await discoverExpertsRequest({
        topic: activeDraft.value.topic,
        limit: 10,
      })
      if (discoveryRunId.value !== runId) return

      const candidates = response.data?.candidates || []
      const meta = response.data?.meta
      const queryCount = meta?.queries?.length || 0
      const resultCount = meta?.resultCount || 0
      const extractionMode = meta?.extractionMode || 'model'
      const extractionLabel =
        extractionMode === 'model'
          ? '已基于实时搜索结果完成模型抽取'
          : extractionMode === 'runtime_agent'
            ? '已由 PI 容器专家运行时完成发现'
            : extractionMode === 'fallback'
              ? '模型抽取失败，已切换为回退排序'
              : '未检索到足够公开资料'
      activeDraft.value.discoveryStatus = [
        '正在发现全球范围内的真实专家',
        '已匹配公开资料与长期代表性人物',
        `已执行 ${queryCount} 组搜索 query，抓取 ${resultCount} 条候选资料`,
        extractionLabel,
      ]
      activeDraft.value.candidates = candidates
      activeDraft.value.selectedCandidateIds = candidates
        .filter(item => item.recommended)
        .slice(0, 5)
        .map(item => item.id)
      activeDraft.value.status = 'selecting_experts'
      activeDraft.value.updatedAt = new Date().toISOString()
    } catch (error) {
      if (discoveryRunId.value !== runId) return
      const message =
        error instanceof Error
          ? error.message
          : '专家发现失败，请检查后端搜索源配置或模型配置后重试'
      activeDraft.value.discoveryStatus = [message]
      activeDraft.value.candidates = []
      activeDraft.value.selectedCandidateIds = []
      activeDraft.value.status = 'drafting'
      activeDraft.value.updatedAt = new Date().toISOString()
    } finally {
      if (discoveryRunId.value === runId) {
        isDiscovering.value = false
      }
    }
  }

  function toggleCandidate(candidateId: string) {
    const selected = new Set(activeDraft.value.selectedCandidateIds)
    if (selected.has(candidateId)) selected.delete(candidateId)
    else selected.add(candidateId)

    activeDraft.value.selectedCandidateIds = Array.from(selected)
    activeDraft.value.updatedAt = new Date().toISOString()
  }

  function updateDraftCandidatePersona(candidateId: string, personaPrompt: string) {
    activeDraft.value.candidates = activeDraft.value.candidates.map(candidate =>
      candidate.id === candidateId ? { ...candidate, personaPrompt } : candidate
    )
    activeDraft.value.updatedAt = new Date().toISOString()
  }

  function regenerateDraftCandidatePersona(candidateId: string, extraNeed = '') {
    const candidate = activeDraft.value.candidates.find(item => item.id === candidateId)
    if (!candidate) return

    updateDraftCandidatePersona(
      candidateId,
      regeneratePersonaPrompt({
        name: candidate.name,
        identity: candidate.identity,
        organization: candidate.organization,
        expertise: candidate.expertise,
        perspective: candidate.perspective,
        stance: candidate.stance,
        topic: activeDraft.value.topic,
        goal: activeDraft.value.goal,
        extraNeed,
        isManual: candidate.isManual,
      })
    )
  }

  function addManualExpertToDraft(name: string) {
    const trimmedName = name.trim()
    if (!trimmedName) return

    const exists = activeDraft.value.candidates.some(item => item.name === trimmedName)
    if (exists) {
      const existing = activeDraft.value.candidates.find(item => item.name === trimmedName)
      if (existing && !activeDraft.value.selectedCandidateIds.includes(existing.id)) {
        activeDraft.value.selectedCandidateIds.push(existing.id)
      }
      activeDraft.value.manualExpertName = ''
      return
    }

    const candidate = createManualExpert(activeDraft.value.topic, trimmedName)
    activeDraft.value.candidates = [candidate, ...activeDraft.value.candidates]
    activeDraft.value.selectedCandidateIds = [
      ...new Set([candidate.id, ...activeDraft.value.selectedCandidateIds]),
    ]
    activeDraft.value.manualExpertName = ''
    activeDraft.value.updatedAt = new Date().toISOString()
  }

  function buildStatusItems(
    responseLength: DiscussionRoom['responseLength'],
    meta?: {
      resultCount?: number
      generationMode?: 'model' | 'fallback' | 'runtime_agent'
    }
  ) {
    const resultCount = meta?.resultCount || 0
    const lengthLabel =
      responseLength === 'brief' ? '简短回应' : responseLength === 'deep' ? '深入回应' : '标准回应'
    const modeLabel =
      meta?.generationMode === 'fallback' ? '模型异常，已切换资料回退' : '已基于实时资料生成'

    return [
      resultCount ? `检索 ${resultCount} 条公开资料` : '未检索到足够公开资料',
      modeLabel,
      lengthLabel,
    ]
  }

  function mapGeneratedMessages(
    room: DiscussionRoom,
    nextRound: number,
    messages: Array<
      Pick<
        DiscussionMessage,
        'participantId' | 'participantType' | 'messageType' | 'content' | 'targetParticipantIds'
      >
    >,
    meta?: {
      resultCount?: number
      generationMode?: 'model' | 'fallback' | 'runtime_agent'
    }
  ) {
    const now = new Date().toISOString()

    return messages
      .map(message => {
        const participant = room.participants.find(item => item.id === message.participantId)
        if (!participant && message.participantId !== 'host') return null

        return {
          id: createId('msg'),
          participantId: message.participantId,
          participantType: message.participantType,
          messageType: message.messageType,
          content: message.content,
          createdAt: now,
          roundIndex: nextRound,
          displayName:
            participant?.displayName ||
            (message.participantId === 'host' ? '群主' : message.participantId),
          roleSummary:
            participant?.roleSummary ||
            (message.participantId === 'host' ? '主持型 agent · 苏格拉底式追问' : undefined),
          perspective: participant?.perspective,
          stance: participant?.stance,
          statusItems:
            message.participantType === 'expert'
              ? buildStatusItems(room.responseLength, meta)
              : undefined,
          targetParticipantIds: message.targetParticipantIds,
        } satisfies DiscussionMessage
      })
      .filter(Boolean) as DiscussionMessage[]
  }

  function getRoomById(roomId: string) {
    return rooms.value.find(item => item.id === roomId) || null
  }

  async function createRoomFromDraft() {
    const selectedExperts = activeDraft.value.candidates.filter(item =>
      activeDraft.value.selectedCandidateIds.includes(item.id)
    )

    if (!selectedExperts.length) return null

    const now = new Date().toISOString()
    const room: DiscussionRoom = {
      id: createId('room'),
      topic: activeDraft.value.topic,
      topicContext: activeDraft.value.topicContext,
      goal: activeDraft.value.goal,
      responseLength: activeDraft.value.responseLength,
      maxRounds: Number(activeDraft.value.maxRounds) || 4,
      currentRound: 1,
      status: 'discussing',
      hostDisclaimer:
        '以下发言为基于公开资料生成的专家代理讨论，仅用于帮助你理解分歧与论点，不代表真人本人真实表述。',
      participants: createParticipants(selectedExperts),
      messages: [],
      liveResponders: [],
      createdAt: now,
      updatedAt: now,
    }

    rooms.value = [room, ...rooms.value.filter(item => item.id !== room.id)]
    currentRoomId.value = room.id
    roomVisible.value = true
    builderVisible.value = false
    activeDraft.value = {
      ...activeDraft.value,
      status: 'room_ready',
      updatedAt: now,
    }

    const initialRunId = nextDiscussionRunId()
    replaceRoom({
      ...room,
      liveResponders: planLiveResponders(room),
      updatedAt: new Date().toISOString(),
    })

    await advanceDiscussionForRoom(room.id, '', {
      runId: initialRunId,
      initial: true,
    })

    return room
  }

  function openRoom(roomId?: string) {
    clearPendingAdvance()
    currentRoomId.value = roomId || lastRoom.value?.id || null
    if (!currentRoomId.value) return
    roomVisible.value = true
    builderVisible.value = false
  }

  function closeRoom() {
    clearPendingAdvance()
    nextDiscussionRunId()
    roomVisible.value = false
  }

  function replaceRoom(room: DiscussionRoom) {
    rooms.value = rooms.value.map(item => (item.id === room.id ? room : item))
  }

  function sendUserMessage(content: string, isInterrupt = false) {
    if (!activeRoom.value || !content.trim()) return

    const room = {
      ...activeRoom.value,
      messages: [...activeRoom.value.messages],
    }

    room.messages.push({
      id: createId('msg'),
      participantId: 'user',
      participantType: 'user',
      messageType: isInterrupt ? 'user_interrupt' : 'agent_status',
      content,
      createdAt: new Date().toISOString(),
      roundIndex: room.currentRound,
      displayName: '你',
      roleSummary: isInterrupt ? '用户插话' : '用户发言',
    })

    replaceRoom(room)
  }

  function advanceDiscussion(prompt = '') {
    if (!activeRoom.value) return
    void advanceDiscussionForRoom(activeRoom.value.id, prompt)
  }

  async function advanceDiscussionForRoom(
    roomId: string,
    prompt = '',
    options?: { runId?: number; initial?: boolean }
  ) {
    if (!roomId) return

    const existingRoom = getRoomById(roomId)
    if (!existingRoom) return

    const runId = options?.runId || nextDiscussionRunId()
    const room = {
      ...existingRoom,
      messages: [...existingRoom.messages],
      participants: [...existingRoom.participants],
      liveResponders: [...existingRoom.liveResponders],
    }

    if (room.status === 'stopped' || room.status === 'finished') {
      if (!prompt.trim()) return
      room.status = 'discussing'
      room.maxRounds = Math.max(room.maxRounds, room.currentRound + 1)
    }

    if (room.currentRound >= room.maxRounds) {
      room.maxRounds = room.currentRound + 1
    }

    try {
      const response = await generateDiscussionTurnRequest({
        roomId: room.id,
        topic: room.topic,
        topicContext: room.topicContext,
        goal: room.goal,
        responseLength: room.responseLength,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        initial: options?.initial,
        prompt: prompt.trim() || undefined,
        participants: room.participants,
        messages: room.messages.map(message => ({
          participantId: message.participantId,
          participantType: message.participantType,
          messageType: message.messageType,
          content: message.content,
          roundIndex: message.roundIndex,
        })),
      })

      if (discussionRunId.value !== runId) return

      const latestRoom = getRoomById(roomId)
      if (!latestRoom) return

      const nextRound =
        response.data?.nextRound || (options?.initial ? room.currentRound : room.currentRound + 1)
      const generatedMessages = mapGeneratedMessages(
        latestRoom,
        nextRound,
        response.data?.messages || [],
        response.data?.meta
      )

      if (!generatedMessages.length) {
        throw new Error('讨论生成结果为空，请检查模型配置后重试')
      }

      const updatedRoom: DiscussionRoom = {
        ...latestRoom,
        currentRound: nextRound,
        status: nextRound >= latestRoom.maxRounds ? 'finished' : 'discussing',
        messages: [...latestRoom.messages, ...generatedMessages],
        liveResponders: [],
        updatedAt: new Date().toISOString(),
      }

      if (updatedRoom.status === 'finished') {
        updatedRoom.messages.push(createSummaryMessage(updatedRoom))
      }

      replaceRoom(updatedRoom)
    } catch (error) {
      if (discussionRunId.value !== runId) return
      const latestRoom = getRoomById(roomId)
      if (!latestRoom) return

      const fallbackMessage: DiscussionMessage = {
        id: createId('msg'),
        participantId: 'host',
        participantType: 'host',
        messageType: 'host_opening',
        content:
          error instanceof Error
            ? `这一轮讨论生成失败：${error.message}`
            : '这一轮讨论生成失败，请检查后端模型或搜索配置后重试。',
        createdAt: new Date().toISOString(),
        roundIndex: options?.initial ? latestRoom.currentRound : latestRoom.currentRound + 1,
        displayName: '群主',
        roleSummary: '主持型 agent · 苏格拉底式追问',
      }

      replaceRoom({
        ...latestRoom,
        liveResponders: [],
        messages: [...latestRoom.messages, fallbackMessage],
        updatedAt: new Date().toISOString(),
      })
    }
  }

  function scheduleAdvance(roomId: string | undefined, prompt = '') {
    if (!roomId) return
    clearPendingAdvance()

    const room = rooms.value.find(item => item.id === roomId)
    if (!room) return

    const runId = nextDiscussionRunId()

    replaceRoom({
      ...room,
      liveResponders: planLiveResponders(room, prompt),
      updatedAt: new Date().toISOString(),
    })

    pendingAdvanceTimer.value = setTimeout(() => {
      pendingAdvanceTimer.value = null
      void advanceDiscussionForRoom(roomId, prompt, { runId })
    }, 260)
  }

  function stopDiscussion() {
    if (!activeRoom.value) return false
    clearPendingAdvance()
    nextDiscussionRunId()
    const room = {
      ...activeRoom.value,
      messages: [...activeRoom.value.messages],
      liveResponders: [],
    }

    if (room.status === 'discussing') {
      room.status = 'stopped'
      room.messages.push(createSummaryMessage(room))
      room.updatedAt = new Date().toISOString()
      replaceRoom(room)
      return true
    }

    return false
  }

  function addExpertToRoom(name: string) {
    if (!activeRoom.value || !name.trim()) return false
    const room = {
      ...activeRoom.value,
      participants: [...activeRoom.value.participants],
      messages: [...activeRoom.value.messages],
    }
    const trimmedName = name.trim()

    if (room.participants.some(item => item.displayName === trimmedName)) return false

    const candidate = createManualExpert(room.topic, trimmedName)
    const participant: DiscussionParticipant = {
      id: candidate.id,
      participantType: 'expert',
      displayName: candidate.name,
      roleSummary: `${candidate.identity} · ${candidate.organization}`,
      organization: candidate.organization,
      perspective: candidate.perspective,
      stance: candidate.stance,
      joinRound: room.currentRound + 1,
      isManual: true,
      personaPrompt: candidate.personaPrompt,
    }

    room.participants = [
      ...room.participants.filter(item => item.id !== 'user'),
      participant,
      ...room.participants.filter(item => item.id === 'user'),
    ]
    room.messages.push(createJoinNotice(participant, room.currentRound))
    room.updatedAt = new Date().toISOString()
    replaceRoom(room)
    return true
  }

  function updateParticipantPersona(participantId: string, personaPrompt: string) {
    if (!activeRoom.value) return
    replaceRoom({
      ...activeRoom.value,
      participants: activeRoom.value.participants.map(participant =>
        participant.id === participantId ? { ...participant, personaPrompt } : participant
      ),
      updatedAt: new Date().toISOString(),
    })
  }

  function regenerateParticipantPersona(participantId: string, extraNeed = '') {
    if (!activeRoom.value) return
    const participant = activeRoom.value.participants.find(item => item.id === participantId)
    if (!participant || participant.participantType === 'user') return

    updateParticipantPersona(
      participantId,
      regeneratePersonaPrompt({
        name: participant.displayName,
        identity: participant.roleSummary.split(' · ')[0] || participant.roleSummary,
        organization: participant.organization || 'Unknown',
        expertise: participant.perspective ? [participant.perspective] : ['主题相关观察'],
        perspective: participant.perspective || '待确认',
        stance: participant.stance || '审慎中立',
        topic: activeRoom.value.topic,
        goal: activeRoom.value.goal,
        extraNeed,
        isManual: participant.isManual,
      })
    )
  }

  return {
    builderVisible,
    roomVisible,
    isDiscovering,
    activeDraft,
    activeRoom,
    lastRoom,
    openBuilder,
    closeBuilder,
    updateDraftField,
    startDiscoverExperts,
    toggleCandidate,
    updateDraftCandidatePersona,
    regenerateDraftCandidatePersona,
    addManualExpertToDraft,
    createRoomFromDraft,
    openRoom,
    closeRoom,
    sendUserMessage,
    advanceDiscussion,
    advanceDiscussionForRoom,
    scheduleAdvance,
    stopDiscussion,
    addExpertToRoom,
    updateParticipantPersona,
    regenerateParticipantPersona,
  }
}
