import { ChatLogService } from './chatLog.service';
import { INTERRUPTED_CHAT_MESSAGE } from '../chat/chatPersistence';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

describe('ChatLogService', () => {
  const buildService = (logs: any[]) => {
    const chatLogEntity = {
      find: jest.fn(async (options?: any) => {
        const rows = [...logs];
        if (options?.order?.createdAt === 'ASC' || options?.order?.id === 'ASC') {
          rows.sort((a, b) => a.id - b.id);
        }
        return rows;
      }),
    };
    const chatGroupEntity = {
      count: jest.fn().mockResolvedValue(1),
    };

    const service = new ChatLogService(
      chatLogEntity as any,
      {} as any,
      chatGroupEntity as any,
      {} as any,
    );

    return { service, chatLogEntity };
  };

  describe('chatList', () => {
    it('returns visible conversation records in chronological order', async () => {
      const { service } = buildService([
        {
          id: 12,
          role: 'assistant',
          content: 'second answer',
          createdAt: new Date('2026-04-19T10:00:02Z'),
        },
        {
          id: 10,
          role: 'user',
          content: 'first question',
          createdAt: new Date('2026-04-19T10:00:00Z'),
        },
        {
          id: 11,
          role: 'assistant',
          content: 'first answer',
          createdAt: new Date('2026-04-19T10:00:01Z'),
        },
      ]);

      const result = await service.chatList({ user: { id: 1 } } as any, { groupId: 9 } as any);

      expect(result.map(item => item.chatId)).toEqual([10, 11, 12]);
    });

    it('replaces transient upstream errors with the interruption guidance in history', async () => {
      const { service } = buildService([
        {
          id: 20,
          role: 'assistant',
          status: 4,
          content: 'This operation was aborted',
          createdAt: new Date('2026-04-19T10:00:00Z'),
        },
      ]);

      const result = await service.chatList({ user: { id: 1 } } as any, { groupId: 9 } as any);

      expect(result[0].content).toBe(INTERRUPTED_CHAT_MESSAGE);
    });

    it('returns persisted ordered stream segments for replaying interrupted task progress', async () => {
      const streamSegments = JSON.stringify([
        {
          id: 'tool-coremi-step',
          type: 'tool_execution',
          tool_call_id: 'coremi-step',
          tool_name: 'coremi',
          event: 'update',
        },
      ]);
      const { service } = buildService([
        {
          id: 21,
          role: 'assistant',
          status: 4,
          content: INTERRUPTED_CHAT_MESSAGE,
          stream_segments: streamSegments,
          createdAt: new Date('2026-04-19T10:00:00Z'),
        },
      ]);

      const result = await service.chatList({ user: { id: 1 } } as any, { groupId: 9 } as any);

      expect(result[0].stream_segments).toBe(streamSegments);
    });
  });
});
