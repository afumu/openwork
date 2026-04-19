export type MinimalToolExecutionPhase = "assembling" | "executing" | "completed";

export interface MinimalToolExecution {
	event: "start" | "update" | "end";
	tool_name: string;
	tool_call_id: string;
	phase: MinimalToolExecutionPhase;
	kind?: "tool" | "workflow_step";
	step?: string;
	step_title?: string;
	display_title?: string;
	display_subtitle?: string;
	target?: string;
	progress?: number;
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
			...(extra?.kind === "tool" || extra?.kind === "workflow_step" ? { kind: extra.kind } : {}),
			...(typeof extra?.step === "string" && extra.step.trim() ? { step: extra.step } : {}),
			...(typeof extra?.step_title === "string" && extra.step_title.trim() ? { step_title: extra.step_title } : {}),
			...(typeof extra?.display_title === "string" && extra.display_title.trim()
				? { display_title: extra.display_title }
				: {}),
			...(typeof extra?.display_subtitle === "string" && extra.display_subtitle.trim()
				? { display_subtitle: extra.display_subtitle }
				: {}),
			...(typeof extra?.target === "string" && extra.target.trim() ? { target: extra.target } : {}),
			...(typeof extra?.progress === "number" && Number.isFinite(extra.progress)
				? { progress: extra.progress }
				: {}),
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
