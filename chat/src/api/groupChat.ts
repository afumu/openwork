import { post } from '@/utils/request'
import type {
  DiscussionMessage,
  DiscussionParticipant,
  ExpertCandidate,
  ResponseLength,
} from '@/views/chat/components/group-chat/types'

export interface DiscoverExpertsResponse {
  candidates: ExpertCandidate[]
  meta?: {
    queries?: string[]
    resultCount?: number
    extractionMode?: 'model' | 'fallback' | 'empty' | 'runtime_agent'
  }
}

export function fetchDiscoverExpertsAPI<T = DiscoverExpertsResponse>(data: {
  topic: string
  limit?: number
}) {
  return post<T>({
    url: '/openwork/discover-experts',
    data,
  })
}

export interface DiscussionTurnResponse {
  nextRound: number
  messages: Array<
    Pick<
      DiscussionMessage,
      'participantId' | 'participantType' | 'messageType' | 'content' | 'targetParticipantIds'
    >
  >
  meta?: {
    queries?: string[]
    resultCount?: number
    generationMode?: 'model' | 'fallback' | 'runtime_agent'
  }
}

export interface DiscussionTurnPayload {
  roomId?: string
  topic: string
  topicContext?: string
  goal?: string
  responseLength: ResponseLength
  currentRound: number
  maxRounds: number
  initial?: boolean
  prompt?: string
  participants: DiscussionParticipant[]
  messages: Pick<
    DiscussionMessage,
    'participantId' | 'participantType' | 'messageType' | 'content' | 'roundIndex'
  >[]
}

export function fetchDiscussionTurnAPI<T = DiscussionTurnResponse>(data: DiscussionTurnPayload) {
  return post<T>({
    url: '/openwork/discussion-turn',
    data,
  })
}
