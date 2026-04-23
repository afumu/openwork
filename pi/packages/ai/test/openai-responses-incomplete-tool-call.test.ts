import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { processResponsesStream } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

async function* toAsyncIterable(events: ResponseStreamEvent[]): AsyncIterable<ResponseStreamEvent> {
	for (const event of events) {
		yield event;
	}
}

function createOutput(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const model: Model<"openai-responses"> = {
	id: "gpt-5.1",
	name: "GPT-5.1",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

describe("OpenAI Responses incomplete tool calls", () => {
	it("keeps completed tool calls when the response finishes normally", async () => {
		const output = createOutput();
		const stream = new AssistantMessageEventStream();
		const events: ResponseStreamEvent[] = [
			{
				type: "response.output_item.added",
				sequence_number: 0,
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "write",
					arguments: "",
					status: "in_progress",
				},
			},
			{
				type: "response.function_call_arguments.done",
				sequence_number: 1,
				item_id: "fc_1",
				output_index: 0,
				name: "write",
				arguments: '{"path":"/workspace/out.md","content":"hello"}',
			},
			{
				type: "response.output_item.done",
				sequence_number: 2,
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "write",
					arguments: '{"path":"/workspace/out.md","content":"hello"}',
					status: "completed",
				},
			},
			{
				type: "response.completed",
				sequence_number: 3,
				response: {
					id: "resp_1",
					object: "response",
					created_at: 0,
					output_text: "",
					status: "completed",
					error: null,
					incomplete_details: null,
					instructions: null,
					max_output_tokens: 32,
					model: "gpt-5.1",
					output: [],
					parallel_tool_calls: true,
					temperature: null,
					tool_choice: "auto",
					tools: [],
					top_p: null,
					background: false,
					metadata: null,
					previous_response_id: undefined,
					reasoning: { effort: null, summary: null },
					text: { format: { type: "text" } },
					truncation: "disabled",
					usage: {
						input_tokens: 10,
						input_tokens_details: { cached_tokens: 0 },
						output_tokens: 12,
						output_tokens_details: { reasoning_tokens: 0 },
						total_tokens: 22,
					},
					user: undefined,
				},
			},
		];

		await processResponsesStream(toAsyncIterable(events), output, stream, model);
		stream.end(output);

		const seenTypes: string[] = [];
		for await (const event of stream) {
			seenTypes.push(event.type);
		}

		expect(seenTypes).toContain("toolcall_start");
		expect(seenTypes).toContain("toolcall_end");
		expect(output.stopReason).toBe("toolUse");
		expect(output.content).toEqual([
			{
				type: "toolCall",
				id: "call_1|fc_1",
				name: "write",
				arguments: {
					path: "/workspace/out.md",
					content: "hello",
				},
			},
		]);
	});

	it("drops truncated tool calls when the response ends with stopReason length", async () => {
		const output = createOutput();
		const stream = new AssistantMessageEventStream();
		const events: ResponseStreamEvent[] = [
			{
				type: "response.output_item.added",
				sequence_number: 0,
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "write",
					arguments: "",
					status: "in_progress",
				},
			},
			{
				type: "response.function_call_arguments.delta",
				sequence_number: 1,
				item_id: "fc_1",
				output_index: 0,
				delta: '{"path":"/workspace/out.md"',
			},
			{
				type: "response.output_item.done",
				sequence_number: 2,
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "write",
					arguments: '{"path":"/workspace/out.md"',
					status: "completed",
				},
			},
			{
				type: "response.completed",
				sequence_number: 3,
				response: {
					id: "resp_1",
					object: "response",
					created_at: 0,
					output_text: "",
					status: "incomplete",
					error: null,
					incomplete_details: { reason: "max_output_tokens" },
					instructions: null,
					max_output_tokens: 32,
					model: "gpt-5.1",
					output: [],
					parallel_tool_calls: true,
					temperature: null,
					tool_choice: "auto",
					tools: [],
					top_p: null,
					background: false,
					metadata: null,
					previous_response_id: undefined,
					reasoning: { effort: null, summary: null },
					text: { format: { type: "text" } },
					truncation: "disabled",
					usage: {
						input_tokens: 10,
						input_tokens_details: { cached_tokens: 0 },
						output_tokens: 32,
						output_tokens_details: { reasoning_tokens: 0 },
						total_tokens: 42,
					},
					user: undefined,
				},
			},
		];

		await processResponsesStream(toAsyncIterable(events), output, stream, model);
		stream.end(output);

		const seenTypes: string[] = [];
		for await (const event of stream) {
			seenTypes.push(event.type);
		}

		expect(seenTypes).toContain("toolcall_start");
		expect(seenTypes).toContain("toolcall_delta");
		expect(seenTypes).not.toContain("toolcall_end");
		expect(output.stopReason).toBe("length");
		expect(output.content).toEqual([]);
	});
});
