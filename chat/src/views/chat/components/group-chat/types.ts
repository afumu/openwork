export type GroupChatPhase =
  | 'idle'
  | 'drafting'
  | 'discovering_experts'
  | 'selecting_experts'
  | 'room_ready'
  | 'discussing'
  | 'stopped'
  | 'finished'

export type ResponseLength = 'brief' | 'balanced' | 'deep'

export type ParticipantType = 'host' | 'expert' | 'user'

export type DiscussionMessageType =
  | 'host_opening'
  | 'expert_message'
  | 'user_interrupt'
  | 'expert_join_notice'
  | 'discussion_summary'
  | 'agent_status'

export interface ExpertCandidate {
  id: string
  name: string
  identity: string
  organization: string
  expertise: string[]
  perspective: string
  stance: string
  recommendationReason: string
  evidenceLabel: string
  evidenceScore: number
  prominenceScore: number
  professionalScore: number
  tier: '临时专家' | '可复用专家' | '优选专家'
  recommended: boolean
  isManual?: boolean
  topicTags: string[]
  personaPrompt: string
}

export interface DiscussionParticipant {
  id: string
  participantType: ParticipantType
  displayName: string
  roleSummary: string
  organization?: string
  perspective?: string
  stance?: string
  joinRound: number
  isManual?: boolean
  personaPrompt?: string
}

export interface DiscussionMessage {
  id: string
  participantId: string
  participantType: ParticipantType
  messageType: DiscussionMessageType
  content: string
  createdAt: string
  roundIndex: number
  displayName: string
  roleSummary?: string
  perspective?: string
  stance?: string
  statusItems?: string[]
  targetParticipantIds?: string[]
}

export interface DiscussionRoom {
  id: string
  topic: string
  topicContext: string
  goal: string
  responseLength: ResponseLength
  maxRounds: number
  currentRound: number
  status: GroupChatPhase
  hostDisclaimer: string
  participants: DiscussionParticipant[]
  messages: DiscussionMessage[]
  liveResponders: {
    participantId: string
    displayName: string
    phase: 'searching' | 'synthesizing' | 'replying'
  }[]
  createdAt: string
  updatedAt: string
}

export interface GroupChatDraft {
  id: string
  topic: string
  topicContext: string
  goal: string
  responseLength: ResponseLength
  maxRounds: number
  status: GroupChatPhase
  discoveryStatus: string[]
  candidates: ExpertCandidate[]
  selectedCandidateIds: string[]
  manualExpertName: string
  createdAt: string
  updatedAt: string
}

export interface GroupChatStorageState {
  draft: GroupChatDraft | null
  rooms: DiscussionRoom[]
  lastRoomId: string | null
}
