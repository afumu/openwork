import { describe, expect, it } from "vitest";
import { handleDiscussionGatewayRequest } from "../src/runtime/discussion/gateway.js";
import { createDiscussionRoomManager } from "../src/runtime/discussion/room-manager.js";
import type {
	DiscussionDiscoveryResult,
	DiscussionRoomSnapshot,
	DiscussionTurnResult,
} from "../src/runtime/discussion/types.js";

describe("runtime discussion gateway request", () => {
	it("dispatches discover_experts through the discussion manager", async () => {
		const manager = createDiscussionRoomManager();
		const result = (await handleDiscussionGatewayRequest(manager, {
			discussion_action: "discover_experts",
			discussion_payload: {
				limit: 10,
				topic: "伊朗和美国冲突对资本市场的影响",
			},
		})) as DiscussionDiscoveryResult;

		expect(result.candidates).toHaveLength(10);
		expect(result.meta.extractionMode).toBe("runtime_agent");
	});

	it("creates a room and generates a discussion turn", async () => {
		const manager = createDiscussionRoomManager();
		const room = (await handleDiscussionGatewayRequest(manager, {
			discussion_action: "create_room",
			discussion_payload: {
				maxRounds: 3,
				participants: [
					{
						displayName: "群主",
						id: "host",
						joinRound: 0,
						participantType: "host",
						roleSummary: "主持型 agent",
					},
					{
						displayName: "Sam Altman",
						id: "expert-sam",
						joinRound: 1,
						participantType: "expert",
						roleSummary: "OpenAI CEO",
						stance: "审慎中立",
					},
				],
				responseLength: "brief",
				roomId: "room-gateway",
				topic: "AI 对教育行业的影响",
			},
		})) as DiscussionRoomSnapshot;

		const turn = (await handleDiscussionGatewayRequest(manager, {
			discussion_action: "continue_round",
			discussion_room_id: room.roomId,
			discussion_payload: {
				initial: true,
			},
		})) as DiscussionTurnResult;

		expect(turn.nextRound).toBe(1);
		expect(turn.messages[0]?.participantId).toBe("host");
		expect((turn.meta.events ?? []).some((event) => event.type === "discussion_message_delta")).toBe(true);
	});
});
