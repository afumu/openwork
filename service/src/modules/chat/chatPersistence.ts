export const TRANSIENT_ASSISTANT_FAILURE_PATTERNS = [
  /This operation was aborted/iu,
  /operation was aborted/iu,
  /AbortError/iu,
  /upstream model request failed/iu,
  /gateway request failed/iu,
  /当前分组上游负载已饱和/iu,
];

export const INTERRUPTED_CHAT_MESSAGE = '任务出现了中断，请点击“继续”接着操作。';

export function looksLikeTransientAssistantFailure(content: string) {
  const normalized = String(content || '').trim();
  return TRANSIENT_ASSISTANT_FAILURE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function shouldTreatAssistantResponseAsInterrupted(data: any) {
  return Boolean(data?.errMsg) || String(data?.finishReason || '').trim() === 'length';
}

export function buildAssistantFailureLogUpdate(data: any) {
  const fullContent = String(data?.full_content || '').trim();
  const update: Record<string, any> = {
    content: fullContent || INTERRUPTED_CHAT_MESSAGE,
    status: 4,
  };

  if (data?.full_reasoning_content) {
    update.reasoning_content = data.full_reasoning_content;
  }
  if (data?.tool_calls) {
    update.tool_calls = data.tool_calls;
  }
  if (data?.tool_execution) {
    update.tool_execution = data.tool_execution;
  }
  if (data?.networkSearchResult) {
    update.networkSearchResult = data.networkSearchResult;
  }
  if (data?.fileVectorResult) {
    update.fileVectorResult = data.fileVectorResult;
  }

  return update;
}
