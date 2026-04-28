import { INTERRUPTED_CHAT_MESSAGE } from './chatPersistence';

export type ToolExecutionStreamItem = {
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
  input?: unknown;
  is_error?: boolean;
  result?: unknown;
  result_preview?: string;
};

type TextStreamSegment = {
  id: string;
  type: 'text';
  text: string;
};

type ReasoningStreamSegment = {
  id: string;
  type: 'reasoning';
  text: string;
};

type ToolExecutionStreamSegment = ToolExecutionStreamItem & {
  id: string;
  type: 'tool_execution';
};

type AssistantStreamSegment =
  | TextStreamSegment
  | ReasoningStreamSegment
  | ToolExecutionStreamSegment;

function mergeToolExecution(
  previous: ToolExecutionStreamSegment | undefined,
  incoming: ToolExecutionStreamItem,
): ToolExecutionStreamSegment {
  return {
    id: `tool-${incoming.tool_call_id}`,
    type: 'tool_execution',
    tool_call_id: incoming.tool_call_id,
    tool_name: incoming.tool_name,
    event: incoming.event || previous?.event || 'update',
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
    input: incoming.input ?? previous?.input,
    is_error: incoming.is_error ?? previous?.is_error,
    result: incoming.result ?? previous?.result,
    result_preview: incoming.result_preview ?? previous?.result_preview,
  };
}

export function createStreamSegmentCollector() {
  const segments: AssistantStreamSegment[] = [];
  const toolSegmentIndexById = new Map<string, number>();
  let lastVisibleSegmentType: 'text' | 'reasoning' | 'tool_execution' | null = null;

  const appendText = (text: string) => {
    if (!text) return;

    const lastSegment = segments[segments.length - 1];
    if (lastVisibleSegmentType === 'text' && lastSegment?.type === 'text') {
      lastSegment.text += text;
      return;
    }

    segments.push({
      id: `text-${segments.length + 1}-${Date.now()}`,
      type: 'text',
      text,
    });
    lastVisibleSegmentType = 'text';
  };

  const appendReasoning = (text: string) => {
    if (!text) return;

    const lastSegment = segments[segments.length - 1];
    if (lastVisibleSegmentType === 'reasoning' && lastSegment?.type === 'reasoning') {
      lastSegment.text += text;
      return;
    }

    segments.push({
      id: `reasoning-${segments.length + 1}-${Date.now()}`,
      type: 'reasoning',
      text,
    });
    lastVisibleSegmentType = 'reasoning';
  };

  const upsertToolExecution = (item: ToolExecutionStreamItem) => {
    if (!item?.tool_call_id || !item?.tool_name) return;

    lastVisibleSegmentType = 'tool_execution';
    const existingIndex = toolSegmentIndexById.get(item.tool_call_id);
    if (existingIndex !== undefined) {
      const existingSegment = segments[existingIndex];
      if (existingSegment?.type === 'tool_execution') {
        segments[existingIndex] = mergeToolExecution(existingSegment, item);
      }
      return;
    }

    toolSegmentIndexById.set(item.tool_call_id, segments.length);
    segments.push(mergeToolExecution(undefined, item));
  };

  const serialize = () => (segments.length ? JSON.stringify(segments) : '');

  const serializeToolExecutions = () => {
    const toolExecutions = segments.filter(
      (segment): segment is ToolExecutionStreamSegment => segment.type === 'tool_execution',
    );

    return toolExecutions.length ? JSON.stringify(toolExecutions) : '';
  };

  return {
    appendReasoning,
    appendText,
    serialize,
    serializeToolExecutions,
    upsertToolExecution,
  };
}

export function appendInterruptedSegment(
  collector: ReturnType<typeof createStreamSegmentCollector>,
) {
  const serialized = collector.serialize();
  if (serialized) {
    try {
      const segments = JSON.parse(serialized);
      const lastSegment = Array.isArray(segments) ? segments[segments.length - 1] : null;
      if (lastSegment?.type === 'text' && lastSegment.text?.includes(INTERRUPTED_CHAT_MESSAGE)) {
        return;
      }
    } catch (error) {
      // 序列化内容异常时仍追加用户可见的中断提示，避免历史记录静默丢失。
    }
  }

  collector.appendText(INTERRUPTED_CHAT_MESSAGE);
}
