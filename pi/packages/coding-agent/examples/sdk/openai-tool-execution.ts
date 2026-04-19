export type MinimalToolExecutionPhase = "assembling" | "executing" | "completed";

export interface MinimalToolExecution {
	event: "start" | "update" | "end";
	tool_name: string;
	tool_call_id: string;
	phase: MinimalToolExecutionPhase;
	args_complete?: boolean;
	args_preview?: string;
	is_error?: boolean;
	result_preview?: string;
}

export interface MinimalToolExecutionDelta {
	tool_execution: MinimalToolExecution;
}

export function buildMinimalToolExecutionDelta(
	event: "start" | "update" | "end",
	toolName: string,
	toolCallId: string,
	phase: MinimalToolExecutionPhase,
	extra?: Record<string, unknown>,
): MinimalToolExecutionDelta {
	return {
		tool_execution: {
			event,
			tool_name: toolName,
			tool_call_id: toolCallId,
			phase,
			...(typeof extra?.args_complete === "boolean" ? { args_complete: extra.args_complete } : {}),
			...(typeof extra?.args_preview === "string" && extra.args_preview.trim()
				? { args_preview: extra.args_preview }
				: {}),
			...(typeof extra?.is_error === "boolean" ? { is_error: extra.is_error } : {}),
			...(typeof extra?.result_preview === "string" && extra.result_preview.trim()
				? { result_preview: extra.result_preview }
				: {}),
		},
	};
}
