import type { DiscussionExpertDiscoveryDependencies } from "./expert-discovery.js";
import type { DiscussionRoomManager } from "./room-manager.js";
import type {
	CreateDiscussionRoomInput,
	DiscussionExpertDiscoveryResult,
	DiscussionRoomSnapshot,
	DiscussionTurnResult,
} from "./types.js";

export type DiscussionGatewayAction = "discover_experts" | "create_room" | "send_message" | "continue_round" | "stop";

export interface DiscussionGatewayRequest {
	discussion_action?: DiscussionGatewayAction;
	discussion_room_id?: string;
	discussion_payload?: unknown;
}

type DiscussionGatewayResult = DiscussionExpertDiscoveryResult | DiscussionRoomSnapshot | DiscussionTurnResult;

export interface DiscussionGatewayOptions {
	discoveryDependencies?: DiscussionExpertDiscoveryDependencies;
	signal?: AbortSignal;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string;
function asString(value: unknown, fallback: string | undefined): string | undefined;
function asString(value: unknown, fallback = "") {
	return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function requireRoomId(request: DiscussionGatewayRequest, payload: Record<string, unknown>) {
	const roomId = asString(request.discussion_room_id || payload.roomId);
	if (!roomId) {
		throw new Error("discussion_room_id is required.");
	}
	return roomId;
}

export async function handleDiscussionGatewayRequest(
	manager: DiscussionRoomManager,
	request: DiscussionGatewayRequest,
	options: DiscussionGatewayOptions = {},
): Promise<DiscussionGatewayResult> {
	const payload = asRecord(request.discussion_payload);

	if (request.discussion_action === "discover_experts") {
		if (options.discoveryDependencies) {
			return manager.discoverExpertsWith(
				{
					limit: asNumber(payload.limit, 10),
					topic: asString(payload.topic),
				},
				options.discoveryDependencies,
				options.signal,
			);
		}
		return manager.discoverExperts(
			{
				limit: asNumber(payload.limit, 10),
				topic: asString(payload.topic),
			},
			options.signal,
		);
	}

	if (request.discussion_action === "create_room") {
		return manager.createRoom(payload as unknown as CreateDiscussionRoomInput);
	}

	if (request.discussion_action === "send_message" || request.discussion_action === "continue_round") {
		return manager.generateTurn(
			{
				initial: Boolean(payload.initial),
				prompt: asString(payload.prompt, undefined),
				roomId: requireRoomId(request, payload),
			},
			options.discoveryDependencies,
			options.signal,
		);
	}

	if (request.discussion_action === "stop") {
		return manager.stopRoom(requireRoomId(request, payload));
	}

	throw new Error(`Unsupported discussion action: ${request.discussion_action ?? "missing"}`);
}
