export const DEFAULT_CHAT_MESSAGE_TYPE = 'message';
export const CONVERSATION_SUMMARY_MESSAGE_TYPE = 'conversation_summary';

export type ConversationMemoryRecord = {
  id?: number;
  userId?: number;
  role: string;
  content: any;
  createdAt?: Date | string;
  imageUrl?: string;
  fileUrl?: string;
  ttsUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  reasoningText?: string;
  tool_calls?: string;
  tool_execution?: string;
  progress?: string;
  messageType?: string;
};

export type ConversationSummaryMetadata = {
  coveredChatLogId?: number;
  sourceMessageCount?: number;
  summaryVersion?: number;
  summarizedAt?: string;
};

export function isConversationSummaryLog(log: { messageType?: string | null } | null | undefined) {
  return log?.messageType === CONVERSATION_SUMMARY_MESSAGE_TYPE;
}

export function parseConversationSummaryMetadata(
  raw: string | ConversationSummaryMetadata | null | undefined,
): ConversationSummaryMetadata | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildConversationMemoryBlock(summary: string) {
  const cleanSummary = String(summary || '').trim();
  if (!cleanSummary) return '';

  return [
    '<conversation_memory>',
    '以下是系统自动维护的历史对话摘要，用于保持同一会话的连续性。它不是用户可见消息，不要向用户解释其生成机制。',
    cleanSummary,
    '</conversation_memory>',
  ].join('\n');
}

export function selectMessagesForSummary(
  records: ConversationMemoryRecord[],
  keepRecentMessageCount = 6,
) {
  const safeKeepCount = Math.max(1, keepRecentMessageCount);
  if (records.length <= safeKeepCount) {
    return {
      messagesToSummarize: [] as ConversationMemoryRecord[],
      recentMessages: records,
      coveredChatLogId: undefined as number | undefined,
    };
  }

  const splitIndex = records.length - safeKeepCount;
  const messagesToSummarize = records.slice(0, splitIndex);
  const recentMessages = records.slice(splitIndex);
  const lastSummarized = messagesToSummarize[messagesToSummarize.length - 1];

  return {
    messagesToSummarize,
    recentMessages,
    coveredChatLogId: lastSummarized?.id,
  };
}

export function stringifyConversationContent(content: any) {
  if (typeof content === 'string') return content;

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function truncateConversationSnippet(value: string, maxChars = 240) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

function parseToolExecutionPayload(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeWorkflowExecution(raw: any) {
  const items = parseToolExecutionPayload(raw);
  const workflowItem = [...items]
    .reverse()
    .find(
      item =>
        item &&
        typeof item === 'object' &&
        (item.kind === 'workflow_step' ||
          item.tool_name === 'openwork_step' ||
          item.tool_name === 'context_compression'),
    );

  if (!workflowItem) return null;

  return {
    stepTitle: String(
      workflowItem.display_title ||
        workflowItem.step_title ||
        workflowItem.step ||
        workflowItem.tool_name ||
        'workflow',
    )
      .replace(/^\[\d+\/\d+\]\s*/u, '')
      .trim(),
    subtitle: truncateConversationSnippet(
      workflowItem.display_subtitle ||
        workflowItem.result_preview ||
        workflowItem.args_preview ||
        '',
      160,
    ),
    target: truncateConversationSnippet(workflowItem.target || '', 180),
  };
}

export function buildConversationTaskStateSnapshot(records: ConversationMemoryRecord[]) {
  const reversed = [...records].reverse();
  const latestUser = reversed.find(
    record => record.role === 'user' && String(record.content || '').trim(),
  );
  const latestAssistant = reversed.find(
    record => record.role === 'assistant' && String(record.content || '').trim(),
  );
  const latestProgress = reversed.find(record => String(record.progress || '').trim());
  const latestWorkflow = reversed
    .map(record => summarizeWorkflowExecution(record.tool_execution))
    .find(item => Boolean(item));
  const latestReasoning = reversed.find(record => String(record.reasoningText || '').trim());
  const interruptedAssistant = reversed.find(record =>
    /任务出现了中断|operation was aborted|继续接着操作/iu.test(String(record.content || '')),
  );

  const lines = [
    latestUser
      ? `- 最近用户目标：${truncateConversationSnippet(
          stringifyConversationContent(latestUser.content),
          180,
        )}`
      : undefined,
    latestWorkflow?.stepTitle ? `- 当前工作流步骤：${latestWorkflow.stepTitle}` : undefined,
    latestWorkflow?.subtitle ? `- 当前步骤说明：${latestWorkflow.subtitle}` : undefined,
    latestProgress ? `- 当前进度：${String(latestProgress.progress).trim()}%` : undefined,
    latestWorkflow?.target ? `- 关键产物：${latestWorkflow.target}` : undefined,
    interruptedAssistant
      ? `- 最近中断信号：${truncateConversationSnippet(
          String(interruptedAssistant.content || ''),
          160,
        )}`
      : undefined,
    latestReasoning
      ? `- 最近推理重点：${truncateConversationSnippet(
          String(latestReasoning.reasoningText || ''),
          180,
        )}`
      : undefined,
    latestAssistant
      ? `- 最近助手状态：${truncateConversationSnippet(String(latestAssistant.content || ''), 180)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export function formatMessagesForSummary(records: ConversationMemoryRecord[]) {
  return records
    .map(record => {
      const id = record.id ? `#${record.id} ` : '';
      const workflow = summarizeWorkflowExecution(record.tool_execution);
      const extras = [
        record.reasoningText
          ? `[reasoning] ${truncateConversationSnippet(String(record.reasoningText || ''), 180)}`
          : undefined,
        record.progress ? `[progress] ${String(record.progress).trim()}` : undefined,
        workflow
          ? `[workflow] ${[workflow.stepTitle, workflow.subtitle, workflow.target]
              .filter(Boolean)
              .join(' | ')}`
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');

      return `${id}${record.role}: ${stringifyConversationContent(record.content)}${
        extras ? `\n${extras}` : ''
      }`;
    })
    .join('\n\n');
}

export function chunkMessagesForSummary(
  records: ConversationMemoryRecord[],
  maxChunkChars = 24000,
) {
  const chunks: ConversationMemoryRecord[][] = [];
  let currentChunk: ConversationMemoryRecord[] = [];
  let currentChars = 0;
  const safeMaxChars = Math.max(1, maxChunkChars);

  for (const record of records) {
    const recordChars = formatMessagesForSummary([record]).length;
    if (currentChunk.length > 0 && currentChars + recordChars > safeMaxChars) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(record);
    currentChars += recordChars;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
