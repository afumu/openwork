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

export function mapBridgeEventToChatProgress(event: BridgeEvent): AgentChatProgress | null {
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
    return {
      tool_execution_delta: {
        args_complete: true,
        args_preview: compactPreview(event.input || event.args || {}),
        event: 'start',
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
        result_preview: compactPreview(preview),
        tool_call_id: getToolCallId(event),
        tool_name: getToolName(event),
      },
    };
  }

  if (event.type === 'tool_finished' || event.type === 'tool_result') {
    return {
      tool_execution_delta: {
        event: 'end',
        phase: 'completed',
        is_error: Boolean(event.is_error || event.error),
        result_preview: compactPreview(
          event.result || event.content || event.tool_use_result || '',
        ),
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
