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

export function formatMessagesForSummary(records: ConversationMemoryRecord[]) {
  return records
    .map(record => {
      const id = record.id ? `#${record.id} ` : '';
      return `${id}${record.role}: ${stringifyConversationContent(record.content)}`;
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
