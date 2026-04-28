declare const describe: any;
declare const expect: any;
declare const it: any;

import {
  buildConversationTaskStateSnapshot,
  buildConversationMemoryBlock,
  chunkMessagesForSummary,
  CONVERSATION_SUMMARY_MESSAGE_TYPE,
  formatMessagesForSummary,
  isConversationSummaryLog,
  parseConversationSummaryMetadata,
  selectMessagesForSummary,
} from './conversationMemory';

describe('conversation memory helpers', () => {
  it('marks only internal summary logs as conversation summaries', () => {
    expect(isConversationSummaryLog({ messageType: CONVERSATION_SUMMARY_MESSAGE_TYPE })).toBe(true);
    expect(isConversationSummaryLog({ messageType: 'message' })).toBe(false);
    expect(isConversationSummaryLog({})).toBe(false);
  });

  it('wraps summaries in a dedicated system memory block', () => {
    expect(buildConversationMemoryBlock('用户确认使用 OpenWork 研究模式。')).toContain(
      '<conversation_memory>',
    );
    expect(buildConversationMemoryBlock('用户确认使用 OpenWork 研究模式。')).toContain(
      '用户确认使用 OpenWork 研究模式。',
    );
  });

  it('parses summary metadata safely', () => {
    expect(parseConversationSummaryMetadata('{"coveredChatLogId":42}')).toEqual({
      coveredChatLogId: 42,
    });
    expect(parseConversationSummaryMetadata('not-json')).toBeNull();
  });

  it('keeps recent messages raw and sends older messages to summarization', () => {
    const records = [
      { id: 1, role: 'user', content: '一' },
      { id: 2, role: 'assistant', content: '二' },
      { id: 3, role: 'user', content: '三' },
      { id: 4, role: 'assistant', content: '四' },
      { id: 5, role: 'user', content: '五' },
    ];

    const result = selectMessagesForSummary(records, 3);

    expect(result.messagesToSummarize.map(record => record.id)).toEqual([1, 2]);
    expect(result.recentMessages.map(record => record.id)).toEqual([3, 4, 5]);
    expect(result.coveredChatLogId).toBe(2);
  });

  it('splits summary input into bounded chunks', () => {
    const chunks = chunkMessagesForSummary(
      [
        { id: 1, role: 'user', content: 'a'.repeat(10) },
        { id: 2, role: 'assistant', content: 'b'.repeat(10) },
        { id: 3, role: 'user', content: 'c'.repeat(10) },
      ],
      35,
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().map(record => record.id)).toEqual([1, 2, 3]);
  });

  it('preserves workflow task state when formatting messages for summarization', () => {
    const records = [
      {
        id: 1,
        role: 'user',
        content: '继续生成市场报告。',
      },
      {
        id: 2,
        role: 'assistant',
        content: '正在处理。',
        progress: '45',
        reasoningText: '当前重点是保留已经完成的检索结果。',
        tool_execution: JSON.stringify([
          {
            kind: 'workflow_step',
            tool_name: 'openwork_step',
            display_title: '[2/4] 资料整理',
            display_subtitle: '正在整理证据表',
            target: 'data/report/evidence.md',
          },
        ]),
      },
    ];

    expect(buildConversationTaskStateSnapshot(records)).toContain('当前工作流步骤：资料整理');
    expect(buildConversationTaskStateSnapshot(records)).toContain(
      '关键产物：data/report/evidence.md',
    );
    expect(formatMessagesForSummary(records)).toContain('[workflow] 资料整理');
    expect(formatMessagesForSummary(records)).toContain('[progress] 45');
  });
});
