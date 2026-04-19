import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick } from 'vue'

import { useGroupChat } from './useGroupChat'
import { discoverExperts } from '../components/group-chat/mock'

type MockWindow = Window & typeof globalThis

function createStorage(options?: { throwOnSet?: boolean }): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      if (options?.throwOnSet) throw new Error('storage blocked')
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

function installWindow(storage: ReturnType<typeof createStorage>) {
  ;(
    globalThis as typeof globalThis & {
      window?: MockWindow
    }
  ).window = {
    ...(globalThis.window ?? {}),
    localStorage: storage,
  } as MockWindow
}

function resetWindow() {
  Reflect.deleteProperty(globalThis as typeof globalThis & { window?: MockWindow }, 'window')
}

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function createRoom(topic = 'AI 对教育行业的长期影响') {
  const groupChat = useGroupChat({
    discoverExperts: async ({ topic }) => ({
      data: { candidates: discoverExperts(topic) },
    }),
    generateDiscussionTurn: async ({ initial, currentRound, participants }) => ({
      data: {
        nextRound: initial ? 1 : currentRound + 1,
        messages: [
          {
            participantId: 'host',
            participantType: 'host',
            messageType: 'host_opening',
            content: initial ? '群主先开场，准备进入真实讨论。' : '群主继续推进本轮分歧。',
          },
          {
            participantId: participants.find(item => item.participantType === 'expert')!.id,
            participantType: 'expert',
            messageType: 'expert_message',
            content: initial ? '这是首轮真实生成的专家发言。' : '这是继续一轮后的专家发言。',
          },
        ],
        meta: {
          resultCount: 4,
          generationMode: 'model',
        },
      },
    }),
  })
  groupChat.openBuilder(topic)
  await groupChat.startDiscoverExperts()
  groupChat.activeDraft.value.selectedCandidateIds = groupChat.activeDraft.value.candidates
    .slice(0, 1)
    .map(item => item.id)
  const room = await groupChat.createRoomFromDraft()

  assert.ok(room, 'expected discussion room to be created')
  return { groupChat, room }
}

test('fails open when localStorage writes throw', async () => {
  installWindow(createStorage({ throwOnSet: true }))
  const warn = console.warn
  console.warn = () => {}

  try {
    const groupChat = useGroupChat()
    groupChat.openBuilder('AI 对教育行业的长期影响')
    groupChat.updateDraftField('topicContext', '关注课堂与教师协作')

    await nextTick()

    assert.equal(groupChat.activeDraft.value.topic, 'AI 对教育行业的长期影响')
    assert.equal(groupChat.activeDraft.value.topicContext, '关注课堂与教师协作')
  } finally {
    console.warn = warn
    resetWindow()
  }
})

test('creates ten candidates and preselects five recommended experts', async () => {
  installWindow(createStorage())

  const groupChat = useGroupChat({
    discoverExperts: async ({ topic }) => ({
      data: { candidates: discoverExperts(topic) },
    }),
    generateDiscussionTurn: async ({ initial, currentRound, participants }) => ({
      data: {
        nextRound: initial ? 1 : currentRound + 1,
        messages: [
          {
            participantId: 'host',
            participantType: 'host',
            messageType: 'host_opening',
            content: '群主开场',
          },
          {
            participantId: participants.find(item => item.participantType === 'expert')!.id,
            participantType: 'expert',
            messageType: 'expert_message',
            content: '真实生成的首轮观点',
          },
        ],
      },
    }),
  })
  groupChat.openBuilder('OpenAI 收购事件对平台竞争的影响')
  await groupChat.startDiscoverExperts()

  assert.equal(groupChat.activeDraft.value.candidates.length, 10)
  assert.equal(groupChat.activeDraft.value.selectedCandidateIds.length, 5)
  assert.equal(groupChat.activeDraft.value.status, 'selecting_experts')
  assert.equal(groupChat.activeDraft.value.responseLength, 'balanced')
  assert.ok(groupChat.activeDraft.value.candidates[0]?.personaPrompt.includes('当前主题'))
  resetWindow()
})

test('stopDiscussion is idempotent and appends a single summary', async () => {
  installWindow(createStorage())
  const { groupChat } = await createRoom()

  groupChat.stopDiscussion()
  groupChat.stopDiscussion()

  const room = groupChat.activeRoom.value
  assert.ok(room)
  assert.equal(room.status, 'stopped')
  assert.equal(room.messages.filter(item => item.messageType === 'discussion_summary').length, 1)
  resetWindow()
})

test('scheduled advance is cancelled when the discussion is stopped', async () => {
  installWindow(createStorage())
  const { groupChat, room } = await createRoom()
  const initialMessageCount = groupChat.activeRoom.value?.messages.length || 0

  groupChat.scheduleAdvance(room.id, '@Sam Altman 你怎么看教育场景')
  groupChat.stopDiscussion()
  await new Promise(resolve => setTimeout(resolve, 980))

  const updatedRoom = groupChat.activeRoom.value
  assert.ok(updatedRoom)
  assert.equal(updatedRoom.status, 'stopped')
  assert.equal(updatedRoom.messages.length, initialMessageCount + 1)
  assert.equal(
    updatedRoom.messages.filter(item => item.messageType === 'discussion_summary').length,
    1
  )
  resetWindow()
})

test('duplicate experts are rejected while new experts can join', async () => {
  installWindow(createStorage())
  const { groupChat } = await createRoom()
  const initialParticipantCount = groupChat.activeRoom.value?.participants.length || 0
  const existingExpertName = groupChat.activeRoom.value?.participants.find(
    item => item.participantType === 'expert'
  )?.displayName

  assert.ok(existingExpertName)
  assert.equal(groupChat.addExpertToRoom(existingExpertName), false)
  assert.equal(groupChat.addExpertToRoom('Dario Amodei'), true)

  const updatedRoom = groupChat.activeRoom.value
  assert.ok(updatedRoom)
  assert.equal(updatedRoom.participants.length, initialParticipantCount + 1)
  assert.equal(
    updatedRoom.participants.filter(item => item.displayName === 'Dario Amodei').length,
    1
  )
  resetWindow()
})

test('regenerates candidate and participant persona prompts with custom needs', async () => {
  installWindow(createStorage())
  const discoverGroupChat = useGroupChat({
    discoverExperts: async ({ topic }) => ({
      data: { candidates: discoverExperts(topic) },
    }),
    generateDiscussionTurn: async ({ initial, currentRound, participants }) => ({
      data: {
        nextRound: initial ? 1 : currentRound + 1,
        messages: [
          {
            participantId: 'host',
            participantType: 'host',
            messageType: 'host_opening',
            content: '群主开场',
          },
          {
            participantId: participants.find(item => item.participantType === 'expert')!.id,
            participantType: 'expert',
            messageType: 'expert_message',
            content: '真实生成的首轮观点',
          },
        ],
      },
    }),
  })
  discoverGroupChat.openBuilder('AI 对资本市场的长期影响')
  await discoverGroupChat.startDiscoverExperts()

  const candidate = discoverGroupChat.activeDraft.value.candidates[0]
  assert.ok(candidate)
  discoverGroupChat.regenerateDraftCandidatePersona(candidate.id, '更尖锐一些，强调风险和估值泡沫')
  const updatedCandidate = discoverGroupChat.activeDraft.value.candidates.find(
    item => item.id === candidate.id
  )
  assert.ok(updatedCandidate?.personaPrompt.includes('更尖锐一些'))

  discoverGroupChat.activeDraft.value.selectedCandidateIds =
    discoverGroupChat.activeDraft.value.candidates.slice(0, 1).map(item => item.id)
  const room = await discoverGroupChat.createRoomFromDraft()
  assert.ok(room)
  const expert = discoverGroupChat.activeRoom.value?.participants.find(
    item => item.participantType === 'expert'
  )
  assert.ok(expert)
  discoverGroupChat.regenerateParticipantPersona(expert.id, '多强调监管和二阶影响')
  const updatedExpert = discoverGroupChat.activeRoom.value?.participants.find(
    item => item.id === expert.id
  )
  assert.ok(updatedExpert?.personaPrompt?.includes('多强调监管和二阶影响'))
  resetWindow()
})

test('discussion room uses generated turn content instead of local mock templates', async () => {
  installWindow(createStorage())
  const groupChat = useGroupChat({
    discoverExperts: async ({ topic }) => ({
      data: { candidates: discoverExperts(topic) },
    }),
    generateDiscussionTurn: async ({ participants }) => ({
      data: {
        nextRound: 1,
        messages: [
          {
            participantId: 'host',
            participantType: 'host',
            messageType: 'host_opening',
            content: '这是一条来自后端生成接口的群主开场。',
          },
          {
            participantId: participants.find(item => item.participantType === 'expert')!.id,
            participantType: 'expert',
            messageType: 'expert_message',
            content: '这是一条来自后端生成接口的专家观点。',
          },
        ],
        meta: {
          resultCount: 6,
          generationMode: 'model',
        },
      },
    }),
  })

  groupChat.openBuilder('AI 对教育行业的长期影响')
  await groupChat.startDiscoverExperts()
  groupChat.activeDraft.value.selectedCandidateIds = groupChat.activeDraft.value.candidates
    .slice(0, 1)
    .map(item => item.id)
  await groupChat.createRoomFromDraft()

  const room = groupChat.activeRoom.value
  assert.ok(room)
  assert.ok(room.messages.some(item => item.content.includes('后端生成接口')))
  assert.equal(
    room.messages.some(item => item.content.includes('今天我们围绕')),
    false
  )
  resetWindow()
})

test('stale discussion generation results are ignored after stopping the room', async () => {
  installWindow(createStorage())
  let resolveTurn: ((value: any) => void) | null = null
  const groupChat = useGroupChat({
    discoverExperts: async ({ topic }) => ({
      data: { candidates: discoverExperts(topic) },
    }),
    generateDiscussionTurn: async ({ initial, currentRound, participants }) =>
      await new Promise(resolve => {
        resolveTurn = resolve
        if (initial) {
          resolve({
            data: {
              nextRound: 1,
              messages: [
                {
                  participantId: 'host',
                  participantType: 'host',
                  messageType: 'host_opening',
                  content: '群主先开场',
                },
                {
                  participantId: 'expert-1',
                  participantType: 'expert',
                  messageType: 'expert_message',
                  content: '首轮观点',
                },
              ],
            },
          })
          return
        }

        resolveTurn = value => resolve(value)
      }),
  })

  groupChat.openBuilder('AI 对教育行业的长期影响')
  await groupChat.startDiscoverExperts()
  groupChat.activeDraft.value.selectedCandidateIds = groupChat.activeDraft.value.candidates
    .slice(0, 1)
    .map(item => item.id)
  await groupChat.createRoomFromDraft()

  const roomId = groupChat.activeRoom.value?.id
  assert.ok(roomId)
  groupChat.scheduleAdvance(roomId, '@专家 请继续')
  await new Promise(resolve => setTimeout(resolve, 300))
  groupChat.stopDiscussion()

  resolveTurn?.({
    data: {
      nextRound: 2,
      messages: [
        {
          participantId: 'host',
          participantType: 'host',
          messageType: 'host_opening',
          content: '这条结果应该被忽略',
        },
        {
          participantId:
            groupChat.activeRoom.value?.participants.find(item => item.participantType === 'expert')
              ?.id || 'missing-expert',
          participantType: 'expert',
          messageType: 'expert_message',
          content: '这条结果也应该被忽略',
        },
      ],
    },
  })

  await flushPromises()

  const room = groupChat.activeRoom.value
  assert.ok(room)
  assert.equal(
    room.messages.some(item => item.content.includes('应该被忽略')),
    false
  )
  resetWindow()
})
