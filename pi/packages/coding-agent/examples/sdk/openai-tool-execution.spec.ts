import { describe, expect, it } from "vitest";
import { buildMinimalToolExecutionDelta, type MinimalToolExecutionDelta } from "./openai-tool-execution.js";

describe("openai tool execution deltas", () => {
	it("only keeps minimal status fields for tool execution chunks", () => {
		const delta = buildMinimalToolExecutionDelta("end", "bash", "call_123", "completed", {
			args_complete: true,
			is_error: false,
			args_preview: 'command: "ls -la"',
			result_preview: "listed 12 files",
			args: { command: "ls -la" },
			result: { content: [{ type: "text", text: "very long output" }] },
			partial_result: { content: [{ type: "text", text: "partial output" }] },
			call_html: "<div>call</div>",
			result_collapsed_html: "<div>collapsed</div>",
			result_expanded_html: "<div>expanded</div>",
		} as Record<string, unknown>);

		expect(delta).toEqual<MinimalToolExecutionDelta>({
			tool_execution: {
				event: "end",
				tool_name: "bash",
				tool_call_id: "call_123",
				phase: "completed",
				args_complete: true,
				is_error: false,
				args_preview: 'command: "ls -la"',
				result_preview: "listed 12 files",
			},
		});
	});
});
