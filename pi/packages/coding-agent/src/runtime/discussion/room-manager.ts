import {
	DiscussionExpertDiscovery,
	type DiscussionExpertDiscoveryDependencies,
	discoverDiscussionExperts,
} from "./expert-discovery.js";
import { DiscussionRoomRuntime } from "./room-runtime.js";
import type {
	CreateDiscussionRoomInput,
	DiscussionExpertDiscoveryResult,
	DiscussionMessage,
	DiscussionRoomSnapshot,
	DiscussionTurnInput,
	DiscussionTurnResult,
} from "./types.js";

export { discoverDiscussionExperts };

export class DiscussionRoomManager {
	private readonly rooms = new Map<string, DiscussionRoomRuntime>();
	private readonly discovery?: DiscussionExpertDiscovery;

	constructor(dependencies?: DiscussionExpertDiscoveryDependencies) {
		this.discovery = dependencies ? new DiscussionExpertDiscovery(dependencies) : undefined;
	}

	async discoverExperts(
		input: { topic: string; limit?: number },
		signal?: AbortSignal,
	): Promise<DiscussionExpertDiscoveryResult> {
		if (this.discovery) {
			return this.discovery.discoverExperts(input, signal);
		}
		return discoverDiscussionExperts(input);
	}

	async discoverExpertsWith(
		input: { topic: string; limit?: number },
		dependencies: DiscussionExpertDiscoveryDependencies,
		signal?: AbortSignal,
	): Promise<DiscussionExpertDiscoveryResult> {
		return new DiscussionExpertDiscovery(dependencies).discoverExperts(input, signal);
	}

	createRoom(input: CreateDiscussionRoomInput): DiscussionRoomSnapshot {
		const room = new DiscussionRoomRuntime(input);
		this.rooms.set(room.roomId, room);
		return room.getSnapshot();
	}

	getRoom(roomId: string): DiscussionRoomSnapshot | undefined {
		return this.rooms.get(roomId)?.getSnapshot();
	}

	async generateTurn(
		input: DiscussionTurnInput,
		dependencies?: DiscussionExpertDiscoveryDependencies,
		signal?: AbortSignal,
	): Promise<DiscussionTurnResult> {
		if (!input.roomId) {
			throw new Error("讨论房间 ID 不能为空");
		}
		const room = this.rooms.get(input.roomId);
		if (!room) {
			throw new Error(`讨论房间不存在：${input.roomId}`);
		}
		const result = room.generateTurn(input);
		if (!dependencies) {
			return result;
		}

		const enhancedMessages = await generateModelBackedTurnMessages(
			room.getSnapshot(),
			result.messages as DiscussionMessage[],
			dependencies,
			signal,
		);
		room.replaceRoundMessages(result.nextRound, enhancedMessages);
		return {
			...result,
			messages: enhancedMessages,
			meta: {
				...result.meta,
				generationMode: "model",
			},
			room: room.getSnapshot(),
		};
	}

	stopRoom(roomId: string): DiscussionRoomSnapshot {
		const room = this.rooms.get(roomId);
		if (!room) {
			throw new Error(`讨论房间不存在：${roomId}`);
		}
		return room.stop();
	}
}

export function createDiscussionRoomManager(dependencies?: DiscussionExpertDiscoveryDependencies) {
	return new DiscussionRoomManager(dependencies);
}

async function generateModelBackedTurnMessages(
	room: DiscussionRoomSnapshot,
	plannedMessages: DiscussionMessage[],
	dependencies: DiscussionExpertDiscoveryDependencies,
	signal?: AbortSignal,
): Promise<DiscussionMessage[]> {
	try {
		const response = await dependencies.generateText({
			systemPrompt: buildTurnSystemPrompt(),
			userPrompt: buildTurnUserPrompt(room, plannedMessages),
			signal,
		});
		return mergeModelMessages(plannedMessages, response);
	} catch {
		return plannedMessages;
	}
}

function buildTurnSystemPrompt() {
	return [
		"你是 OpenWork PI 容器里的专家讨论运行时。",
		"你需要基于真实专家公开资料风格、房间上下文和主持节奏生成中文群聊消息。",
		"不要冒充真人本人，不要声称消息来自真人；这是基于公开资料生成的专家代理讨论。",
		"只返回 JSON 数组，不要输出 markdown，不要输出解释。",
		"每个对象必须包含 participantId 和 content 字段。",
		"content 要具体、有观点、有分歧，避免套话和重复模板。",
	].join("\n");
}

function buildTurnUserPrompt(room: DiscussionRoomSnapshot, plannedMessages: DiscussionMessage[]) {
	return JSON.stringify(
		{
			topic: room.topic,
			topicContext: room.topicContext,
			goal: room.goal,
			responseLength: room.responseLength,
			currentRound: room.currentRound,
			maxRounds: room.maxRounds,
			participants: room.participants.map((participant) => ({
				id: participant.id,
				displayName: participant.displayName,
				participantType: participant.participantType,
				roleSummary: participant.roleSummary,
				perspective: participant.perspective,
				stance: participant.stance,
				personaPrompt: participant.personaPrompt,
			})),
			recentMessages: room.messages.slice(-12),
			plannedMessages: plannedMessages.map((message) => ({
				participantId: message.participantId,
				participantType: message.participantType,
				messageType: message.messageType,
				targetParticipantIds: message.targetParticipantIds,
			})),
		},
		null,
		2,
	);
}

function mergeModelMessages(plannedMessages: DiscussionMessage[], raw: string): DiscussionMessage[] {
	const parsed = parseModelMessageArray(raw);
	if (!parsed.length) {
		return plannedMessages;
	}

	return plannedMessages.map((message) => {
		const modelMessage = parsed.find((item) => item.participantId === message.participantId);
		if (!modelMessage?.content?.trim()) {
			return message;
		}
		return {
			...message,
			content: modelMessage.content.trim(),
		};
	});
}

function parseModelMessageArray(raw: string): Array<{ participantId: string; content: string }> {
	const jsonText = extractJsonArrayText(raw);
	if (!jsonText) {
		return [];
	}
	try {
		const parsed = JSON.parse(jsonText);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.map((item) => {
				if (!item || typeof item !== "object") {
					return undefined;
				}
				const record = item as Record<string, unknown>;
				return {
					participantId: String(record.participantId || ""),
					content: String(record.content || ""),
				};
			})
			.filter((item): item is { participantId: string; content: string } =>
				Boolean(item?.participantId && item.content),
			);
	} catch {
		return [];
	}
}

function extractJsonArrayText(raw: string) {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		return fenced[1].trim();
	}
	const start = raw.indexOf("[");
	const end = raw.lastIndexOf("]");
	if (start >= 0 && end > start) {
		return raw.slice(start, end + 1);
	}
	return raw.trim();
}
