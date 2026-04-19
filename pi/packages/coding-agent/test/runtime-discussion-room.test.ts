import { describe, expect, it } from "vitest";
import { createDiscussionRoomManager, discoverDiscussionExperts } from "../src/runtime/discussion/room-manager.js";
import type { DiscussionParticipant } from "../src/runtime/discussion/types.js";

const participants: DiscussionParticipant[] = [
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
		personaPrompt: "你现在扮演专家代理 Sam Altman。",
		perspective: "技术 / 产品",
		roleSummary: "OpenAI CEO",
		stance: "审慎中立",
	},
	{
		displayName: "Ray Dalio",
		id: "expert-dalio",
		joinRound: 1,
		participantType: "expert",
		personaPrompt: "你现在扮演专家代理 Ray Dalio。",
		perspective: "投资 / 商业",
		roleSummary: "Bridgewater 创始人",
		stance: "批判质疑",
	},
];

describe("runtime discussion room", () => {
	it("discovers ten topic-related experts and recommends five", () => {
		const result = discoverDiscussionExperts({
			limit: 10,
			topic: "讨论一些最近伊朗和美国战争对资本市场的影响",
		});

		expect(result.candidates).toHaveLength(10);
		expect(result.candidates.filter((candidate) => candidate.recommended)).toHaveLength(5);
		expect(result.candidates[0]?.personaPrompt).toContain("你现在扮演专家代理");
		expect(result.meta.extractionMode).toBe("runtime_agent");
		expect(result.meta.queries.length).toBeGreaterThan(0);
	});

	it("creates a room and generates a host-led opening turn", async () => {
		const manager = createDiscussionRoomManager();
		const room = manager.createRoom({
			maxRounds: 4,
			participants,
			responseLength: "balanced",
			roomId: "room-1",
			topic: "中东冲突对全球资本市场和 AI 产业链的影响",
			topicContext: "重点关注资本开支和风险偏好",
		});

		const result = await manager.generateTurn({
			initial: true,
			roomId: room.roomId,
		});

		expect(result.nextRound).toBe(1);
		expect(result.meta.generationMode).toBe("runtime_agent");
		expect(result.messages[0]).toMatchObject({
			participantId: "host",
			participantType: "host",
			messageType: "host_opening",
		});
		expect(result.messages.some((message) => message.participantId === "expert-sam")).toBe(true);
	});

	it("prioritizes mentioned experts during follow-up turns", async () => {
		const manager = createDiscussionRoomManager();
		manager.createRoom({
			maxRounds: 4,
			participants,
			responseLength: "balanced",
			roomId: "room-mentions",
			topic: "AI 资本开支和全球风险偏好",
		});

		const result = await manager.generateTurn({
			prompt: "@Ray Dalio 你怎么看避险情绪？",
			roomId: "room-mentions",
		});

		expect(result.messages[0]?.targetParticipantIds).toContain("expert-dalio");
		expect(result.messages[1]?.participantId).toBe("expert-dalio");
	});

	it("stops a room and refuses to generate more messages", async () => {
		const manager = createDiscussionRoomManager();
		manager.createRoom({
			maxRounds: 4,
			participants,
			responseLength: "brief",
			roomId: "room-stop",
			topic: "AI 对教育行业的长期影响",
		});

		const stopped = manager.stopRoom("room-stop");

		expect(stopped.status).toBe("stopped");
		await expect(manager.generateTurn({ roomId: "room-stop" })).rejects.toThrow("讨论已停止");
	});
});
