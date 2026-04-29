import { ChatService } from './chat.service';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

function createChatService(
  openAIChatService: any = { chatFree: jest.fn() },
  openSandboxRuntimeService?: any,
  chatGroupService: any = {},
  modelsService: any = {},
) {
  return new ChatService(
    {} as any,
    {} as any,
    openAIChatService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    chatGroupService as any,
    modelsService as any,
    {} as any,
    undefined as any,
    openSandboxRuntimeService,
  );
}

describe('ChatService history building', () => {
  it('falls back to an OpenAI-compatible model for ordinary chats with anthropic model config', async () => {
    const fallbackModel = {
      apiFormat: 'openai',
      keyType: 1,
      model: 'gpt-5.3-codex',
      modelName: 'gpt-5.3-codex',
    };
    const service = createChatService(undefined, undefined, {}, {
      getFirstOpenAICompatibleChatModel: jest.fn().mockResolvedValue(fallbackModel),
    });

    const resolved = await (service as any).resolveOrdinaryChatModelKeyInfo(
      {
        apiFormat: 'anthropic',
        keyType: 1,
        model: 'deepseek-v4-flash',
        modelName: 'deepseek',
      },
      {
        groupType: 'chat',
        id: 59,
      },
      'trace-test',
    );

    expect(resolved).toBe(fallbackModel);
  });

  it('keeps anthropic model config for project chats', async () => {
    const modelsService = {
      getFirstOpenAICompatibleChatModel: jest.fn(),
    };
    const service = createChatService(undefined, undefined, {}, modelsService);
    const projectModel = {
      apiFormat: 'anthropic',
      keyType: 1,
      model: 'deepseek-v4-flash',
      modelName: 'deepseek',
    };

    const resolved = await (service as any).resolveOrdinaryChatModelKeyInfo(
      projectModel,
      {
        groupType: 'project',
        id: 60,
      },
      'trace-test',
    );

    expect(resolved).toBe(projectModel);
    expect(modelsService.getFirstOpenAICompatibleChatModel).not.toHaveBeenCalled();
  });

  it('does not query OpenSandbox runtime status for ordinary chat groups', async () => {
    const runtimeService = {
      getRuntimeStatus: jest.fn(),
      getOpenWorkProjectStatus: jest.fn(),
    };
    const service = createChatService(undefined, runtimeService, {
      getGroupInfoFromId: jest.fn().mockResolvedValue({
        groupType: 'chat',
        id: 128,
        userId: 42,
      }),
    });

    const status = await service.runtimeStatus({ groupId: 128 }, { user: { id: 42 } } as any);

    expect(status).toEqual({
      groupId: 128,
      mode: 'opensandbox',
      running: false,
      status: 'not_project',
      userId: 42,
    });
    expect(runtimeService.getRuntimeStatus).not.toHaveBeenCalled();
    expect(runtimeService.getOpenWorkProjectStatus).not.toHaveBeenCalled();
  });

  it('returns an OpenSandbox preview URL based on the OpenWork dev server port', async () => {
    const runtimeService = {
      getOpenWorkProjectStatus: jest.fn().mockResolvedValue({
        dev: {
          port: 9000,
          running: true,
        },
        devPort: 9000,
        ok: true,
      }),
      getRuntimeStatus: jest.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:57212/proxy/8787',
        endpointHeaders: { 'x-open-sandbox-token': 'signed' },
        groupId: 128,
        mode: 'opensandbox',
        sandboxId: 'sbx-preview',
        status: 'Running',
        userId: 42,
        workspaceDir: '/workspace',
        workspaceRoot: '/workspace',
      }),
    };
    const service = createChatService(undefined, runtimeService, {
      getGroupInfoFromId: jest.fn().mockResolvedValue({
        groupType: 'project',
        id: 128,
        userId: 42,
      }),
    });

    const status = await service.runtimeStatus({ groupId: 128 }, { user: { id: 42 } } as any);

    expect(runtimeService.getOpenWorkProjectStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 128,
        userId: 42,
      }),
    );
    expect(status.preview).toEqual({
      path: '/proxy/9000',
      port: 9000,
      running: true,
      url: 'http://127.0.0.1:57212/proxy/9000',
    });
  });

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
