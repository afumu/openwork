import { Injectable } from '@nestjs/common';
import { OpenAIChatService } from '../aiTool/chat/chat.service';
import { DiscussionTurnDto } from './dto/discussionTurn.dto';

type GeneratedTurnMessage = {
  participantId: string;
  participantType: 'host' | 'expert';
  messageType: 'host_opening' | 'expert_message';
  content: string;
  targetParticipantIds?: string[];
};

export interface GroupDiscussionTurnResult {
  nextRound: number;
  messages: GeneratedTurnMessage[];
  meta: {
    queries: string[];
    resultCount: number;
    generationMode: 'model' | 'fallback' | 'runtime_agent';
    events?: unknown[];
  };
}

@Injectable()
export class GroupDiscussionService {
  constructor(private readonly openAIChatService: OpenAIChatService) {}

  async generateTurn(
    body: DiscussionTurnDto,
    userId?: number,
    traceId?: string,
  ): Promise<GroupDiscussionTurnResult> {
    const topic = body?.topic?.trim();
    if (!topic) {
      throw new Error('讨论主题不能为空');
    }

    const experts = (body.participants || []).filter(item => item.participantType === 'expert');
    if (!experts.length) {
      throw new Error('至少需要一位专家才能开始讨论');
    }

    const roomId = body.roomId || `discussion-room-${Date.now()}`;
    const sessionId = `discussion-${roomId}`;
    const roomPayload = this.buildRoomPayload(body, roomId, topic);

    await this.openAIChatService.requestPiDiscussion({
      action: 'create_room',
      payload: roomPayload,
      roomId,
      sessionId,
      userId,
      traceId,
      workspaceDir: `conversations/${roomId}`,
    });

    return this.openAIChatService.requestPiDiscussion<GroupDiscussionTurnResult>({
      action: body.prompt ? 'send_message' : 'continue_round',
      payload: {
        ...roomPayload,
        initial: Boolean(body.initial),
        prompt: body.prompt,
      },
      roomId,
      sessionId,
      userId,
      traceId,
      workspaceDir: `conversations/${roomId}`,
    });
  }

  private buildRoomPayload(body: DiscussionTurnDto, roomId: string, topic: string) {
    return {
      roomId,
      topic,
      topicContext: body.topicContext,
      goal: body.goal,
      responseLength: body.responseLength || 'balanced',
      currentRound: Number(body.currentRound || 0),
      maxRounds: Number(body.maxRounds || 4),
      participants: body.participants || [],
      messages: (body.messages || []).map(message => ({
        participantId: message.participantId,
        participantType: message.participantType,
        messageType: message.messageType,
        content: message.content,
        roundIndex: Number(message.roundIndex || 0),
        createdAt: Date.now(),
      })),
    };
  }
}
