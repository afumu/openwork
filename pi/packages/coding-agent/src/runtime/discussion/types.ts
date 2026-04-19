import type { WebSearchResultItem } from "../web-search-tool.js";

export type DiscussionResponseLength = "brief" | "balanced" | "deep";

export type DiscussionParticipantType = "host" | "expert" | "user";

export type DiscussionParticipantPerspective =
	| "技术 / 产品"
	| "学术 / 研究"
	| "投资 / 商业"
	| "产业 / 应用"
	| "政策 / 治理";

export type DiscussionParticipantStance = "乐观推动" | "审慎中立" | "批判质疑";

export type DiscussionParticipantTier = "临时专家" | "可复用专家" | "优选专家";

export interface DiscussionExpertCandidate {
	id: string;
	name: string;
	identity: string;
	organization: string;
	expertise: string[];
	perspective: DiscussionParticipantPerspective;
	stance: DiscussionParticipantStance;
	recommendationReason: string;
	evidenceLabel: string;
	evidenceScore: number;
	prominenceScore: number;
	professionalScore: number;
	tier: DiscussionParticipantTier;
	recommended: boolean;
	isManual?: boolean;
	topicTags: string[];
	personaPrompt: string;
}

export interface DiscussionDiscoveryMeta {
	queries: string[];
	resultCount: number;
	extractionMode: "model" | "fallback" | "empty" | "runtime_agent";
}

export interface DiscussionDiscoveryResult {
	candidates: DiscussionExpertCandidate[];
	meta: DiscussionDiscoveryMeta;
}

export type DiscussionExpertDiscoveryResult = DiscussionDiscoveryResult;

export interface DiscussionRoomParticipant extends Partial<DiscussionExpertCandidate> {
	id: string;
	displayName: string;
	participantType: DiscussionParticipantType;
	roleSummary: string;
	joinRound: number;
}

export interface DiscussionRoomMessage {
	participantId: string;
	participantType: DiscussionParticipantType;
	messageType:
		| "host_opening"
		| "expert_message"
		| "user_interrupt"
		| "expert_join_notice"
		| "discussion_summary"
		| "agent_status";
	content: string;
	roundIndex: number;
	targetParticipantIds?: string[];
	createdAt: number;
}

export interface DiscussionRoomState {
	roomId: string;
	topic: string;
	topicContext?: string;
	goal?: string;
	responseLength: DiscussionResponseLength;
	maxRounds: number;
	currentRound: number;
	status: "draft" | "ready" | "discussing" | "stopped" | "finished";
	hostAgentProfile: {
		displayName: string;
		roleSummary: string;
		personaPrompt: string;
	};
	participants: DiscussionRoomParticipant[];
	transcript: DiscussionRoomMessage[];
	sourcePool: WebSearchResultItem[];
	createdAt: number;
	updatedAt: number;
}

export interface DiscussionTurnMeta {
	queries: string[];
	resultCount: number;
	generationMode: "model" | "fallback" | "runtime_agent";
	events?: DiscussionRuntimeEvent[];
}

export interface DiscussionTurnMessage {
	participantId: string;
	participantType: DiscussionParticipantType;
	messageType: "host_opening" | "expert_message";
	content: string;
	targetParticipantIds?: string[];
}

export interface DiscussionTurnResult {
	roomId?: string;
	nextRound: number;
	messages: DiscussionTurnMessage[];
	meta: DiscussionTurnMeta;
	events?: DiscussionRuntimeEvent[];
	room?: DiscussionRoomSnapshot;
}

export interface DiscussionRuntimeEvent {
	type:
		| "discussion_room_state"
		| "discussion_member_status"
		| "discussion_message_start"
		| "discussion_message_delta"
		| "discussion_message_end"
		| "discussion_sources_update"
		| "discussion_error";
	roomId: string;
	participantId?: string;
	participantType?: DiscussionParticipantType;
	label?: string;
	status?: string;
	content?: string;
	queryCount?: number;
	resultCount?: number;
	messageType?: DiscussionRoomMessage["messageType"];
	delta?: string;
	roundIndex?: number;
	displayName?: string;
}

export interface DiscussionDiscoveryRequest {
	topic: string;
	limit?: number;
}

export interface DiscussionRoomCreationInput {
	roomId?: string;
	topic: string;
	topicContext?: string;
	goal?: string;
	responseLength: DiscussionResponseLength;
	maxRounds: number;
	selectedExperts: DiscussionExpertCandidate[];
	userDisplayName?: string;
}

export interface DiscussionTurnInput {
	roomId?: string;
	topic?: string;
	topicContext?: string;
	goal?: string;
	responseLength?: DiscussionResponseLength;
	currentRound?: number;
	maxRounds?: number;
	initial?: boolean;
	prompt?: string;
	participants?: DiscussionRoomParticipant[];
	messages?: DiscussionRoomMessage[];
}

export type DiscussionParticipant = DiscussionRoomParticipant;
export type DiscussionMessage = DiscussionTurnMessage & { roundIndex?: number };
export type DiscussionHistoryMessage = DiscussionRoomMessage;
export interface DiscussionRoomSnapshot {
	roomId: string;
	topic: string;
	topicContext?: string;
	goal?: string;
	responseLength: DiscussionResponseLength;
	maxRounds: number;
	currentRound: number;
	status: "discussing" | "stopped" | "finished";
	participants: DiscussionParticipant[];
	messages: DiscussionHistoryMessage[];
	sourcePool: string[];
}
export type CreateDiscussionRoomInput = {
	roomId?: string;
	topic: string;
	topicContext?: string;
	goal?: string;
	responseLength: DiscussionResponseLength;
	maxRounds: number;
	currentRound?: number;
	participants: DiscussionParticipant[];
	messages?: DiscussionHistoryMessage[];
};
