export type ToolExecutionState = {
  tool_call_id: string;
  tool_name: string;
  event: 'start' | 'update' | 'end';
  phase?: 'assembling' | 'executing' | 'completed';
  kind?: 'tool' | 'workflow_step';
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
};

export type ToolCallState = {
  id?: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

export function mergeToolExecutionState(
  previous: Partial<ToolExecutionState> | undefined,
  incoming: Partial<ToolExecutionState> & Pick<ToolExecutionState, 'tool_call_id' | 'tool_name'>,
): ToolExecutionState {
  return {
    tool_call_id: incoming.tool_call_id,
    tool_name: incoming.tool_name,
    event: (incoming.event || previous?.event || 'update') as 'start' | 'update' | 'end',
    phase: incoming.phase ?? previous?.phase,
    kind: incoming.kind ?? previous?.kind,
    step: incoming.step ?? previous?.step,
    step_title: incoming.step_title ?? previous?.step_title,
    display_title: incoming.display_title ?? previous?.display_title,
    display_subtitle: incoming.display_subtitle ?? previous?.display_subtitle,
    target: incoming.target ?? previous?.target,
    progress: incoming.progress ?? previous?.progress,
    args_complete: incoming.args_complete ?? previous?.args_complete,
    args_preview: incoming.args_preview ?? previous?.args_preview,
    is_error: incoming.is_error ?? previous?.is_error,
    result_preview: incoming.result_preview ?? previous?.result_preview,
  };
}

export function buildToolExecutionProgressDelta(toolExecution: ToolExecutionState) {
  return {
    tool_execution_delta: toolExecution,
  };
}

export function serializeToolExecutionStates(toolExecutions: Iterable<ToolExecutionState>) {
  return JSON.stringify([...toolExecutions]);
}

export function mergeToolCallState(
  previous: ToolCallState | undefined,
  incoming: {
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  },
): ToolCallState {
  return {
    id: incoming.id ?? previous?.id,
    type: incoming.type || previous?.type || 'function',
    function: {
      name: incoming.function?.name || previous?.function?.name || '',
      arguments: `${previous?.function?.arguments || ''}${incoming.function?.arguments || ''}`,
    },
  };
}

export function serializeToolCallStates(toolCalls: Iterable<ToolCallState>) {
  return JSON.stringify([...toolCalls]);
}
