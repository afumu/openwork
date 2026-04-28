import { handleError } from '@/common/utils';
import { Injectable, Logger } from '@nestjs/common';
import { mapBridgeEventToChatProgress } from './agentEventMapper';
import { OpenSandboxRuntimeService } from './opensandboxRuntime.service';
import type {
  AgentChatProgress,
  BridgeAgent,
  BridgeEvent,
  RuntimeDescriptor,
} from './opensandboxRuntime.types';

type AgentChatInput = {
  agent?: BridgeAgent;
  apiFormat?: string;
  apiKey?: string;
  chatId: number | string;
  groupId: number | string;
  model?: string;
  modelName?: string;
  modelAvatar?: string;
  prompt: string;
  proxyUrl?: string;
  traceId?: string;
  userId: number;
  abortController: AbortController;
  onProgress?: (data: AgentChatProgress) => void;
  onFailure?: (data: any) => void;
};

type ParsedSseEvent = {
  id?: string;
  event?: string;
  data?: string;
};

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function bridgeUrl(descriptor: RuntimeDescriptor, path: string) {
  return `${stripTrailingSlash(descriptor.baseUrl)}/${path.replace(/^\/+/g, '')}`;
}

function getBridgePaths() {
  const apiPrefix = String(process.env.OPENWORK_AGENT_BRIDGE_API_PREFIX || '').replace(
    /^\/+|\/+$/g,
    '',
  );

  if (apiPrefix) {
    return {
      eventsPath: `/${apiPrefix}/agent/events`,
      messagePaths: [`/${apiPrefix}/agent/message`, `/${apiPrefix}/agent/runs`],
    };
  }

  return {
    eventsPath: process.env.OPENWORK_AGENT_EVENTS_PATH || '/events',
    messagePaths: ['/message', '/v1/agent/message', '/v1/agent/runs'],
  };
}

function extractText(value: any) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item : item?.text || item?.content || ''))
      .join('');
  }
  return '';
}

function normalizeBridgeEvent(event: BridgeEvent): BridgeEvent {
  if (event.type === 'tool_use') {
    return {
      ...event,
      tool: event.name,
      type: 'tool_started',
    };
  }

  if (event.type === 'tool_result') {
    return {
      ...event,
      result: event.result || extractText(event.content) || event.tool_use_result,
      tool: event.name || event.tool_name,
      type: 'tool_finished',
    };
  }

  if (event.type === 'turn_complete') {
    return {
      ...event,
      type: 'run_completed',
    };
  }

  return event;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  const lines = block.split(/\r?\n/);
  const parsed: ParsedSseEvent = {};
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'id') parsed.id = value;
    if (field === 'event') parsed.event = value;
    if (field === 'data') data.push(value);
  }

  if (!parsed.id && !parsed.event && data.length === 0) return null;
  parsed.data = data.join('\n');
  return parsed;
}

async function readSseStream(
  response: any,
  onEvent: (event: BridgeEvent) => Promise<boolean | void>,
) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body as any) {
    buffer += decoder.decode(chunk, { stream: true });
    let separatorIndex = buffer.search(/\r?\n\r?\n/);

    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + (buffer[separatorIndex] === '\r' ? 4 : 2));
      const parsed = parseSseBlock(block);
      if (parsed?.data) {
        const event = JSON.parse(parsed.data);
        const shouldStop = await onEvent(event);
        if (shouldStop) return;
      }
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }
  }
}

@Injectable()
export class OpenSandboxAgentChatService {
  private readonly logger = new Logger(OpenSandboxAgentChatService.name);

  constructor(private readonly runtimeService: OpenSandboxRuntimeService) {}

  async chat(input: AgentChatInput) {
    const result: any = {
      chatId: input.chatId,
      finishReason: null,
      full_content: '',
      full_reasoning_content: '',
      model: input.model || 'claude_code',
      modelAvatar: input.modelAvatar,
      modelName: input.modelName || 'Claude Code',
      status: 2,
      tool_execution: '',
    };

    try {
      const descriptor = await this.runtimeService.ensureRuntime({
        apiBaseUrl: input.proxyUrl,
        apiFormat: input.apiFormat,
        apiKey: input.apiKey,
        groupId: input.groupId,
        model: input.model && input.model !== 'claude_code' ? input.model : undefined,
        traceId: input.traceId,
        userId: input.userId,
      });
      const health = await this.fetchBridgeHealth(descriptor);
      const since = Number(health?.next_event_id || 1) - 1;
      const eventController = new AbortController();
      const abortEvents = () => {
        eventController.abort();
      };
      input.abortController.signal.addEventListener('abort', abortEvents, { once: true });

      const eventStream = this.openEventStream(descriptor, since, eventController.signal);
      await this.postMessage(descriptor, {
        agent: input.agent || 'claude_code',
        metadata: {
          chatId: input.chatId,
          groupId: input.groupId,
          userId: input.userId,
        },
        prompt: input.prompt,
        session_id: `chat-${input.groupId}`,
        text: input.prompt,
        workspace_dir: descriptor.workspaceDir,
      });

      await readSseStream(await eventStream, async rawEvent => {
        if (input.abortController.signal.aborted) {
          await this.runtimeService.stopAgent(descriptor);
          result.finishReason = 'aborted';
          return true;
        }

        const event = normalizeBridgeEvent(rawEvent);
        const progress = mapBridgeEventToChatProgress(event);
        if (progress?.content?.length) {
          result.full_content += progress.content.map(item => item.text).join('');
        }
        if (progress?.reasoning_content?.length) {
          result.full_reasoning_content += progress.reasoning_content
            .map(item => item.text)
            .join('');
        }
        if (progress?.tool_execution_delta) {
          result.tool_execution = JSON.stringify(progress.tool_execution_delta);
        }
        if (progress) {
          input.onProgress?.(progress);
        }

        if (event.type === 'run_completed') {
          const finalText = extractText(event.result);
          if (finalText && !result.full_content.includes(finalText)) {
            result.full_content += finalText;
          }
          result.finishReason = event.is_error ? 'error' : 'stop';
          return true;
        }

        if (event.type === 'run_failed' || event.type === 'error') {
          result.errMsg = event.error || event.message || 'OpenSandbox agent run failed';
          result.finishReason = 'error';
          return true;
        }

        return false;
      });

      input.abortController.signal.removeEventListener('abort', abortEvents);
      result.finishReason = result.finishReason || 'stop';
      return result;
    } catch (error) {
      const errorMessage = handleError(error);
      this.logger.error(
        `[traceId=${input.traceId || '-'}] OpenSandbox agent 聊天失败: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      result.errMsg = errorMessage;
      result.finishReason = 'error';
      input.onFailure?.(result);
      return result;
    }
  }

  private async fetchBridgeHealth(descriptor: RuntimeDescriptor) {
    const response = await fetch(bridgeUrl(descriptor, 'health'), {
      headers: descriptor.endpointHeaders,
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  private async openEventStream(descriptor: RuntimeDescriptor, since: number, signal: AbortSignal) {
    const { eventsPath } = getBridgePaths();
    const url = new URL(bridgeUrl(descriptor, eventsPath));
    if (since > 0) url.searchParams.set('since', String(since));
    const response = await fetch(url.toString(), {
      headers: {
        ...(descriptor.endpointHeaders || {}),
        Accept: 'text/event-stream',
      },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenSandbox bridge events failed: HTTP ${response.status}`);
    }

    return response;
  }

  private async postMessage(descriptor: RuntimeDescriptor, payload: Record<string, any>) {
    const { messagePaths } = getBridgePaths();
    let lastError = '';

    for (const path of messagePaths) {
      const response = await fetch(bridgeUrl(descriptor, path), {
        body: JSON.stringify(payload),
        headers: {
          ...(descriptor.endpointHeaders || {}),
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      if (response.ok) {
        return;
      }

      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;
      if (response.status !== 404) break;
    }

    this.logger.error(`OpenSandbox bridge message failed: ${lastError}`);
    throw new Error(`OpenSandbox bridge message failed: ${lastError}`);
  }
}
