import type {
	CreateDiscussionRoomInput,
	DiscussionHistoryMessage,
	DiscussionMessage,
	DiscussionParticipant,
	DiscussionRoomSnapshot,
	DiscussionRuntimeEvent,
	DiscussionTurnInput,
	DiscussionTurnResult,
} from "./types.js";

function normalizeText(value = "") {
	return value.replace(/\s+/g, " ").trim();
}

function buildRoomId(topic: string) {
	const slug =
		topic
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "discussion";
	return `runtime-room-${slug}`;
}

function getExperts(participants: DiscussionParticipant[]) {
	return participants.filter((participant) => participant.participantType === "expert");
}

function findMentionedExpert(experts: DiscussionParticipant[], prompt?: string) {
	if (!prompt) return undefined;
	return experts.find((expert) => prompt.includes(`@${expert.displayName}`) || prompt.includes(expert.displayName));
}

function pickCounterExpert(experts: DiscussionParticipant[], leadExpert?: DiscussionParticipant) {
	if (!leadExpert) return undefined;
	return (
		experts.find((expert) => expert.id !== leadExpert.id && expert.stance && expert.stance !== leadExpert.stance) ??
		experts.find((expert) => expert.id !== leadExpert.id)
	);
}

function createMemberStatusEvent(
	roomId: string,
	participant: DiscussionParticipant,
	status: string,
	label: string,
): DiscussionRuntimeEvent {
	return {
		displayName: participant.displayName,
		label,
		participantId: participant.id,
		participantType: participant.participantType,
		roomId,
		status,
		type: "discussion_member_status",
	};
}

function createMessageEvents(
	roomId: string,
	message: DiscussionMessage,
	displayName?: string,
): DiscussionRuntimeEvent[] {
	const common = {
		displayName,
		messageType: message.messageType,
		participantId: message.participantId,
		participantType: message.participantType,
		roomId,
		roundIndex: message.roundIndex,
	};
	return [
		{ ...common, type: "discussion_message_start" as const },
		{ ...common, delta: message.content, type: "discussion_message_delta" as const },
		{ ...common, type: "discussion_message_end" as const },
	];
}

function buildHostMessage(input: {
	roomId: string;
	roundIndex: number;
	topic: string;
	prompt?: string;
	leadExpert?: DiscussionParticipant;
	counterExpert?: DiscussionParticipant;
	initial?: boolean;
}): DiscussionMessage {
	const focus = input.prompt
		? `用户刚刚把焦点推进到“${normalizeText(input.prompt)}”。`
		: input.initial
			? `我们先把“${input.topic}”拆成能力变化、市场定价和长期风险三条线。`
			: `进入第 ${input.roundIndex} 轮，我会继续放大最有价值的分歧。`;
	const lead = input.leadExpert?.displayName ?? "一位专家";
	const counter = input.counterExpert?.displayName ?? "另一位不同视角专家";
	return {
		content: `${focus} 我先请 ${lead} 给出正面判断，再请 ${counter} 补充反方或边界条件。`,
		messageType: "host_opening",
		participantId: "host",
		participantType: "host",
		roundIndex: input.roundIndex,
		targetParticipantIds: [input.leadExpert?.id, input.counterExpert?.id].filter(Boolean) as string[],
	};
}

function buildExpertMessage(input: {
	expert: DiscussionParticipant;
	topic: string;
	prompt?: string;
	responseLength: string;
	isCounterpoint: boolean;
	roundIndex: number;
}): DiscussionMessage {
	const direct = input.prompt ? `直接回应“${normalizeText(input.prompt)}”，` : "";
	const angle = input.expert.perspective ?? input.expert.roleSummary;
	const stance = input.expert.stance ?? (input.isCounterpoint ? "审慎中立" : "乐观推动");
	const base = `${direct}我会从${angle}切入。围绕“${input.topic}”，我的立场偏${stance}，关键不是单一事件本身，而是它会不会改变预期、预算和组织决策。`;
	const tail =
		input.responseLength === "brief"
			? "我先给短判断：先看结构变量，再看短期噪音。"
			: input.responseLength === "deep"
				? "如果展开看，我会把短期市场反应、中期资源配置、长期制度与产业格局三层拆开，避免把情绪误判成趋势。"
				: "下一步更值得追问的是，这个变化能否持续传导到真实流程，而不是只停留在叙事层面。";
	const counter = input.isCounterpoint ? "我也会提醒，前一个判断里最容易被低估的是执行摩擦和时间错配。" : "";
	return {
		content: [base, counter, tail].filter(Boolean).join(""),
		messageType: "expert_message",
		participantId: input.expert.id,
		participantType: "expert",
		roundIndex: input.roundIndex,
	};
}

export class DiscussionRoomRuntime {
	private snapshot: DiscussionRoomSnapshot;

	constructor(input: CreateDiscussionRoomInput) {
		const topic = input.topic.trim();
		if (!topic) {
			throw new Error("讨论主题不能为空");
		}
		if (getExperts(input.participants).length === 0) {
			throw new Error("至少需要一位专家才能开始讨论");
		}

		this.snapshot = {
			currentRound: input.currentRound ?? 0,
			goal: input.goal,
			maxRounds: input.maxRounds,
			messages: input.messages ?? [],
			participants: input.participants,
			responseLength: input.responseLength,
			roomId: input.roomId ?? buildRoomId(topic),
			sourcePool: [],
			status: "discussing",
			topic,
			topicContext: input.topicContext,
		};
	}

	get roomId() {
		return this.snapshot.roomId;
	}

	getSnapshot(): DiscussionRoomSnapshot {
		return {
			...this.snapshot,
			messages: [...this.snapshot.messages],
			participants: [...this.snapshot.participants],
			sourcePool: [...this.snapshot.sourcePool],
		};
	}

	stop() {
		this.snapshot.status = "stopped";
		return this.getSnapshot();
	}

	generateTurn(input: DiscussionTurnInput): DiscussionTurnResult {
		if (this.snapshot.status === "stopped") {
			throw new Error("讨论已停止");
		}
		if (this.snapshot.status === "finished") {
			throw new Error("讨论已结束");
		}

		const roundIndex = input.initial ? 1 : this.snapshot.currentRound + 1;
		const experts = getExperts(this.snapshot.participants);
		const mentioned = findMentionedExpert(experts, input.prompt);
		const leadExpert = mentioned ?? experts[(roundIndex - 1) % experts.length];
		const counterExpert = pickCounterExpert(experts, leadExpert);
		const messages = [
			buildHostMessage({
				counterExpert,
				initial: input.initial,
				leadExpert,
				prompt: input.prompt,
				roomId: this.snapshot.roomId,
				roundIndex,
				topic: this.snapshot.topic,
			}),
			leadExpert
				? buildExpertMessage({
						expert: leadExpert,
						isCounterpoint: false,
						prompt: input.prompt,
						responseLength: this.snapshot.responseLength,
						roundIndex,
						topic: this.snapshot.topic,
					})
				: undefined,
			counterExpert
				? buildExpertMessage({
						expert: counterExpert,
						isCounterpoint: true,
						prompt: input.prompt,
						responseLength: this.snapshot.responseLength,
						roundIndex,
						topic: this.snapshot.topic,
					})
				: undefined,
		].filter((message): message is DiscussionMessage => Boolean(message));

		const queries = this.buildQueries(input.prompt, leadExpert, counterExpert);
		this.snapshot.currentRound = roundIndex;
		this.snapshot.messages.push(...this.toHistoryMessages(messages));
		this.snapshot.sourcePool.push(...queries);
		if (this.snapshot.currentRound >= this.snapshot.maxRounds) {
			this.snapshot.status = "finished";
		}

		return {
			messages,
			meta: {
				events: this.buildEvents(messages, leadExpert, counterExpert),
				generationMode: "runtime_agent",
				queries,
				resultCount: queries.length,
			},
			nextRound: roundIndex,
		};
	}

	replaceRoundMessages(roundIndex: number, messages: DiscussionMessage[]) {
		this.snapshot.messages = this.snapshot.messages.filter((message) => message.roundIndex !== roundIndex);
		this.snapshot.messages.push(...this.toHistoryMessages(messages));
		return this.getSnapshot();
	}

	private buildQueries(prompt?: string, leadExpert?: DiscussionParticipant, counterExpert?: DiscussionParticipant) {
		const focus = normalizeText(prompt ?? this.snapshot.topicContext ?? "核心争议").slice(0, 60);
		return [
			`${this.snapshot.topic} ${focus} 专家 观点`,
			`${this.snapshot.topic} ${leadExpert?.displayName ?? ""} ${counterExpert?.displayName ?? ""}`.trim(),
		].filter(Boolean);
	}

	private buildEvents(
		messages: DiscussionMessage[],
		leadExpert?: DiscussionParticipant,
		counterExpert?: DiscussionParticipant,
	) {
		const events: DiscussionRuntimeEvent[] = [
			{
				roomId: this.snapshot.roomId,
				roundIndex: this.snapshot.currentRound,
				status: this.snapshot.status,
				type: "discussion_room_state",
			},
		];
		for (const expert of [leadExpert, counterExpert].filter((participant): participant is DiscussionParticipant =>
			Boolean(participant),
		)) {
			events.push(
				createMemberStatusEvent(this.snapshot.roomId, expert, "searching", "正在整理公开资料与房间上下文"),
			);
			events.push(createMemberStatusEvent(this.snapshot.roomId, expert, "responding", "正在组织回应"));
		}
		for (const message of messages) {
			const participant = this.snapshot.participants.find((item) => item.id === message.participantId);
			events.push(...createMessageEvents(this.snapshot.roomId, message, participant?.displayName));
		}
		return events;
	}

	private toHistoryMessages(messages: DiscussionMessage[]): DiscussionHistoryMessage[] {
		return messages.map((message) => ({
			content: message.content,
			createdAt: Date.now(),
			messageType: message.messageType,
			participantId: message.participantId,
			participantType: message.participantType,
			roundIndex: message.roundIndex ?? this.snapshot.currentRound,
		}));
	}
}
