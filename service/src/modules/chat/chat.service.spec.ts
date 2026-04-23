import { ChatService } from './chat.service';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

function createChatService() {
  return new ChatService(
    {} as any,
    {} as any,
    { chatFree: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('ChatService history building', () => {
  it('keeps earlier user messages when interrupted assistant logs are empty or transient errors', async () => {
    const service = createChatService();
    const chatLogService = {
      findLatestConversationSummary: jest.fn().mockResolvedValue(null),
      findConversationContextLogs: jest.fn().mockResolvedValue([
        {
          id: 1,
          role: 'user',
          content: '第一步：先分析市场。',
          createdAt: new Date('2026-04-19T10:00:00.000Z'),
        },
        {
          id: 2,
          role: 'assistant',
          content: 'This operation was aborted',
          status: 4,
          createdAt: new Date('2026-04-19T10:01:00.000Z'),
        },
        {
          id: 3,
          role: 'user',
          content: '第二步：继续补充财务影响。',
          createdAt: new Date('2026-04-19T10:02:00.000Z'),
        },
        {
          id: 4,
          role: 'assistant',
          content: '',
          status: 5,
          createdAt: new Date('2026-04-19T10:03:00.000Z'),
        },
        {
          id: 5,
          role: 'user',
          content: '第三步：继续输出。',
          createdAt: new Date('2026-04-19T10:04:00.000Z'),
        },
      ]),
    };

    const { messagesHistory } = await (service as any).buildMessageFromParentMessageId(
      {
        groupId: 99,
        maxModelTokens: 64000,
        maxRounds: 10,
        systemMessage: '系统提示',
      },
      chatLogService,
    );

    expect(messagesHistory.map(message => message.content)).toEqual([
      '系统提示',
      '第一步：先分析市场。',
      '第二步：继续补充财务影响。',
      '第三步：继续输出。',
    ]);
  });

  it('keeps partial assistant content from an interrupted response when it is meaningful', async () => {
    const service = createChatService();
    const chatLogService = {
      findLatestConversationSummary: jest.fn().mockResolvedValue(null),
      findConversationContextLogs: jest.fn().mockResolvedValue([
        {
          id: 1,
          role: 'user',
          content: '请生成报告。',
          createdAt: new Date('2026-04-19T10:00:00.000Z'),
        },
        {
          id: 2,
          role: 'assistant',
          content: '这是中断前已经完成的报告片段。',
          status: 4,
          createdAt: new Date('2026-04-19T10:01:00.000Z'),
        },
        {
          id: 3,
          role: 'user',
          content: '继续。',
          createdAt: new Date('2026-04-19T10:02:00.000Z'),
        },
      ]),
    };

    const { messagesHistory } = await (service as any).buildMessageFromParentMessageId(
      {
        groupId: 99,
        maxModelTokens: 64000,
        maxRounds: 10,
        systemMessage: '',
      },
      chatLogService,
    );

    expect(messagesHistory.map(message => message.content)).toEqual([
      '请生成报告。',
      '这是中断前已经完成的报告片段。',
      '继续。',
    ]);
  });

  it('restores assistant tool calls and matching tool results from persisted history', async () => {
    const service = createChatService();
    const toolCalls = JSON.stringify([
      {
        id: 'tool-call-1',
        type: 'function',
        function: {
          name: 'read',
          arguments: '{"path":"/workspace/AGENTS.md"}',
        },
      },
    ]);
    const toolExecution = JSON.stringify([
      {
        tool_call_id: 'tool-call-1',
        tool_name: 'read',
        event: 'end',
        phase: 'completed',
        result_preview: '# Repository Guidelines\\n\\nRead docs first.',
      },
    ]);
    const chatLogService = {
      findLatestConversationSummary: jest.fn().mockResolvedValue(null),
      findConversationContextLogs: jest.fn().mockResolvedValue([
        {
          id: 1,
          role: 'user',
          content: '继续刚才中断的流程。',
          createdAt: new Date('2026-04-19T10:00:00.000Z'),
        },
        {
          id: 2,
          role: 'assistant',
          content: '好的，我先读取项目说明。',
          tool_calls: toolCalls,
          tool_execution: toolExecution,
          createdAt: new Date('2026-04-19T10:01:00.000Z'),
        },
        {
          id: 3,
          role: 'user',
          content: '继续。',
          createdAt: new Date('2026-04-19T10:02:00.000Z'),
        },
      ]),
    };

    const { messagesHistory } = await (service as any).buildMessageFromParentMessageId(
      {
        groupId: 99,
        maxModelTokens: 64000,
        maxRounds: 10,
        systemMessage: '系统提示',
      },
      chatLogService,
    );

    expect(messagesHistory).toEqual([
      {
        role: 'system',
        content: '系统提示',
      },
      {
        role: 'user',
        content: '继续刚才中断的流程。',
      },
      {
        role: 'assistant',
        content: '好的，我先读取项目说明。',
        tool_calls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'read',
              arguments: '{"path":"/workspace/AGENTS.md"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-call-1',
        content: '# Repository Guidelines\\n\\nRead docs first.',
      },
      {
        role: 'user',
        content: '继续。',
      },
    ]);
  });
});
