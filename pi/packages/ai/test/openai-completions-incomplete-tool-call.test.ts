import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { streamSimple } from "../src/stream.js";
import type { Tool } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	chunks: undefined as
		| Array<null | { id?: string; choices?: Array<{ delta: Record<string, unknown>; finish_reason: string | null }> }>
		| undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: async () => ({
					async *[Symbol.asyncIterator]() {
						for (const chunk of mockState.chunks ?? []) {
							yield chunk;
						}
					},
				}),
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openai-completions incomplete tool calls", () => {
	it("drops truncated tool calls when finish_reason is length", async () => {
		mockState.chunks = [
			{
				id: "chatcmpl_1",
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									type: "function",
									function: {
										name: "write",
										arguments: '{"path":"/workspace/out.md"',
									},
								},
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				id: "chatcmpl_1",
				choices: [
					{
						delta: {},
						finish_reason: "length",
					},
				],
			},
		];

		const tools: Tool[] = [
			{
				name: "write",
				description: "Write content to a file",
				parameters: Type.Object({
					path: Type.String(),
					content: Type.String(),
				}),
			},
		];

		const stream = streamSimple(
			{
				id: "gpt-4o-mini",
				name: "GPT-4o mini",
				api: "openai-completions",
				provider: "openai",
				baseUrl: "https://api.openai.com/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
			{
				systemPrompt: "You are a helpful assistant.",
				messages: [{ role: "user", content: "Write a file", timestamp: Date.now() }],
				tools,
			},
			{ apiKey: "test" },
		);

		const eventTypes: string[] = [];
		for await (const event of stream) {
			eventTypes.push(event.type);
		}

		const result = await stream.result();
		expect(eventTypes).toContain("toolcall_start");
		expect(eventTypes).toContain("toolcall_delta");
		expect(eventTypes).not.toContain("toolcall_end");
		expect(result.stopReason).toBe("length");
		expect(result.content).toEqual([]);
	});
});
