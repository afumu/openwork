import type { AgentChatProgress, BridgeEvent } from './opensandboxRuntime.types';

function compactPreview(value: any, maxLength = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getToolCallId(event: BridgeEvent) {
  return String(event.tool_call_id || event.toolUseId || event.id || event.run_id || 'tool');
}

function getToolName(event: BridgeEvent) {
  return String(event.tool || event.name || event.tool_name || 'tool');
}

function getToolInput(event: BridgeEvent) {
  return event.input ?? event.args ?? event.parameters;
}

function getToolResult(event: BridgeEvent) {
  return event.tool_use_result ?? event.result ?? event.content ?? event.output;
}

type PendingToolUseBlock = {
  input: unknown;
  inputJson: string;
  toolCallId: string;
  toolName: string;
};

type BridgeEventMapperState = {
  streamedReasoningText: string;
  toolUseBlocks: Map<number, PendingToolUseBlock>;
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePartialJson(value: string) {
  if (!value.trim()) return undefined;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return undefined;
  }
}

function getSdkStreamEvent(event: BridgeEvent) {
  const raw = event.type === 'raw_sdk_message' ? event.raw : event;
  if (!isRecord(raw) || raw.type !== 'stream_event' || !isRecord(raw.event)) {
    return null;
  }

  return raw.event;
}

function mapSdkStreamEventToChatProgress(
  event: BridgeEvent,
  state: BridgeEventMapperState,
): AgentChatProgress | null {
  const streamEvent = getSdkStreamEvent(event);
  if (!streamEvent) return null;

  const index = Number(streamEvent.index);
  if (!Number.isFinite(index)) return null;

  if (streamEvent.type === 'content_block_start' && isRecord(streamEvent.content_block)) {
    const block = streamEvent.content_block;
    if (block.type === 'thinking') {
      const text = String(block.thinking || '');
      if (!text) return null;
      state.streamedReasoningText += text;
      return {
        reasoning_content: [{ type: 'text', text }],
      };
    }

    if (block.type !== 'tool_use') return null;

    const toolCallId = String(block.id || block.tool_call_id || `tool-${index}`);
    const toolName = String(block.name || block.tool_name || 'tool');
    const input = block.input ?? {};
    const inputJson =
      isRecord(input) && Object.keys(input).length === 0 ? '' : compactPreview(input);
    state.toolUseBlocks.set(index, {
      input,
      inputJson,
      toolCallId,
      toolName,
    });

    return {
      tool_execution_delta: {
        args_complete: Boolean(inputJson),
        args_preview: inputJson || '{}',
        event: 'start',
        input,
        phase: inputJson ? 'executing' : 'assembling',
        tool_call_id: toolCallId,
        tool_name: toolName,
      },
    };
  }

  if (streamEvent.type === 'content_block_delta' && isRecord(streamEvent.delta)) {
    const delta = streamEvent.delta;
    if (delta.type === 'thinking_delta') {
      const text = String(delta.thinking || '');
      if (!text) return null;
      state.streamedReasoningText += text;
      return {
        reasoning_content: [{ type: 'text', text }],
      };
    }

    if (delta.type !== 'input_json_delta') return null;

    const block = state.toolUseBlocks.get(index);
    if (!block) return null;

    const partialJson = String(delta.partial_json || '');
    if (!partialJson) return null;

    block.inputJson += partialJson;
    const parsedInput = parsePartialJson(block.inputJson);
    if (parsedInput !== undefined) {
      block.input = parsedInput;
    }

    return {
      tool_execution_delta: {
        args_complete: false,
        args_preview: compactPreview(parsedInput ?? block.inputJson),
        event: 'update',
        input: parsedInput ?? block.inputJson,
        phase: 'assembling',
        tool_call_id: block.toolCallId,
        tool_name: block.toolName,
      },
    };
  }

  if (streamEvent.type === 'content_block_stop') {
    const block = state.toolUseBlocks.get(index);
    if (!block) return null;

    const parsedInput = parsePartialJson(block.inputJson);
    const input = parsedInput ?? block.input;
    state.toolUseBlocks.delete(index);

    return {
      tool_execution_delta: {
        args_complete: true,
        args_preview: compactPreview(input ?? (block.inputJson || {})),
        event: 'start',
        input,
        phase: 'executing',
        tool_call_id: block.toolCallId,
        tool_name: block.toolName,
      },
    };
  }

  return null;
}

export function mapBridgeEventToChatProgress(event: BridgeEvent): AgentChatProgress | null {
  const streamProgress = mapSdkStreamEventToChatProgress(event, {
    streamedReasoningText: '',
    toolUseBlocks: new Map(),
  });
  if (streamProgress) return streamProgress;

  if (!event || !event.type) return null;

  if (event.type === 'assistant_delta' || event.type === 'assistant_text') {
    const text = String(event.text || '');
    if (!text) return null;
    return {
      content: [{ type: 'text', text }],
    };
  }

  if (event.type === 'assistant_thinking') {
    const text = String(event.text || '');
    if (!text) return null;
    return {
      reasoning_content: [{ type: 'text', text }],
    };
  }

  if (event.type === 'tool_started' || event.type === 'tool_use') {
    const input = getToolInput(event);
    return {
      tool_execution_delta: {
        args_complete: true,
        args_preview: compactPreview(input || {}),
        event: 'start',
        input,
        phase: 'executing',
        tool_call_id: getToolCallId(event),
        tool_name: getToolName(event),
      },
    };
  }

  if (event.type === 'tool_output') {
    const preview = event.stdout || event.stderr || event.output || event.text || '';
    return {
      tool_execution_delta: {
        event: 'update',
        phase: 'executing',
        result: preview,
        result_preview: compactPreview(preview),
        tool_call_id: getToolCallId(event),
        tool_name: getToolName(event),
      },
    };
  }

  if (event.type === 'tool_finished' || event.type === 'tool_result') {
    const result = getToolResult(event);
    return {
      tool_execution_delta: {
        event: 'end',
        phase: 'completed',
        is_error: Boolean(event.is_error || event.error),
        result,
        result_preview: compactPreview(event.content || event.output || event.text || result || ''),
        tool_call_id: getToolCallId(event),
        tool_name: getToolName(event),
      },
    };
  }

  if (
    event.type === 'run_started' ||
    event.type === 'session_started' ||
    event.type === 'bridge_ready'
  ) {
    return {
      tool_execution_delta: {
        event: 'start',
        kind: 'workflow_step',
        phase: 'executing',
        step: 'opensandbox_agent',
        display_title: 'Claude Code 容器已启动',
        display_subtitle: event.cwd || event.workspace_dir || undefined,
        tool_call_id: String(event.run_id || event.session_id || 'opensandbox-agent'),
        tool_name: 'opensandbox_agent',
      },
    };
  }

  return null;
}

export function createBridgeEventProgressMapper() {
  const state: BridgeEventMapperState = {
    streamedReasoningText: '',
    toolUseBlocks: new Map(),
  };

  return (event: BridgeEvent): AgentChatProgress | null => {
    const streamProgress = mapSdkStreamEventToChatProgress(event, state);
    if (streamProgress) return streamProgress;

    if (event.type === 'assistant_thinking') {
      const text = String(event.text || '');
      if (!text) return null;

      if (state.streamedReasoningText) {
        if (text === state.streamedReasoningText || state.streamedReasoningText.includes(text)) {
          return null;
        }
        if (text.startsWith(state.streamedReasoningText)) {
          const suffix = text.slice(state.streamedReasoningText.length);
          state.streamedReasoningText = text;
          return suffix ? { reasoning_content: [{ type: 'text', text: suffix }] } : null;
        }
      }

      state.streamedReasoningText += text;
      return {
        reasoning_content: [{ type: 'text', text }],
      };
    }

    return mapBridgeEventToChatProgress(event);
  };
}
