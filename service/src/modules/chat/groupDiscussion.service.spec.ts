declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

jest.mock('../aiTool/chat/chat.service', () => ({
  OpenAIChatService: class OpenAIChatService {},
}));

import { GroupDiscussionService } from './groupDiscussion.service';

describe('GroupDiscussionService', () => {
  const baseBody = {
    roomId: 'room-1',
    topic: '中东冲突对全球资本市场和 AI 产业链的影响',
    topicContext: '重点关注资本开支和风险偏好',
    goal: '把最重要的分歧讲透',
    responseLength: 'balanced' as const,
    currentRound: 1,
    maxRounds: 4,
    participants: [
      {
        id: 'host',
        participantType: 'host' as const,
        displayName: '群主',
        roleSummary: '主持型 agent · 苏格拉底式追问',
        joinRound: 0,
      },
      {
        id: 'expert-sam',
        participantType: 'expert' as const,
        displayName: 'Sam Altman',
        roleSummary: 'OpenAI CEO · OpenAI',
        perspective: '技术 / 产品',
        stance: '审慎中立',
        joinRound: 1,
        personaPrompt: '你现在扮演专家代理 Sam Altman。',
      },
    ],
    messages: [
      {
        participantId: 'host',
        participantType: 'host' as const,
        messageType: 'host_opening' as const,
        content: '先把问题拆开。',
        roundIndex: 1,
      },
    ],
  };

  it('creates the PI runtime room before requesting the next turn', async () => {
    const openAIChatService = {
      requestPiDiscussion: jest
        .fn()
        .mockResolvedValueOnce({ roomId: 'room-1', status: 'discussing' })
        .mockResolvedValueOnce({
          nextRound: 2,
          messages: [
            {
              participantId: 'host',
              participantType: 'host',
              messageType: 'host_opening',
              content: '这轮先追问预算和风险偏好的错配。',
            },
            {
              participantId: 'expert-sam',
              participantType: 'expert',
              messageType: 'expert_message',
              content: '我会从平台预算角度看待这个变化。',
            },
          ],
          meta: {
            queries: ['中东冲突 AI 资本开支 专家 观点'],
            resultCount: 6,
            generationMode: 'model',
          },
        }),
    };
    const service = new GroupDiscussionService(openAIChatService as any);

    const result = await service.generateTurn(baseBody as any, 7, 'trace-2');

    expect(openAIChatService.requestPiDiscussion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'create_room',
        roomId: 'room-1',
        userId: 7,
        traceId: 'trace-2',
      }),
    );
    expect(openAIChatService.requestPiDiscussion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'continue_round',
        roomId: 'room-1',
      }),
    );
    expect(result.meta.generationMode).toBe('model');
    expect(result.messages[1].participantId).toBe('expert-sam');
  });

  it('rejects discussion turns without experts before calling PI', async () => {
    const openAIChatService = {
      requestPiDiscussion: jest.fn(),
    };
    const service = new GroupDiscussionService(openAIChatService as any);

    await expect(
      service.generateTurn({
        ...baseBody,
        participants: baseBody.participants.filter(item => item.participantType !== 'expert'),
      } as any),
    ).rejects.toThrow('至少需要一位专家');
    expect(openAIChatService.requestPiDiscussion).not.toHaveBeenCalled();
  });
});
