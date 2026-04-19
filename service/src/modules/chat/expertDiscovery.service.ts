import { Injectable } from '@nestjs/common';
import { OpenAIChatService } from '../aiTool/chat/chat.service';

export interface ExpertDiscoveryCandidate {
  id: string;
  name: string;
  identity: string;
  organization: string;
  expertise: string[];
  perspective: string;
  stance: string;
  recommendationReason: string;
  evidenceLabel: string;
  evidenceScore: number;
  prominenceScore: number;
  professionalScore: number;
  tier: '临时专家' | '可复用专家' | '优选专家';
  recommended: boolean;
  isManual?: boolean;
  topicTags: string[];
  personaPrompt: string;
}

export interface ExpertDiscoveryMeta {
  queries: string[];
  resultCount: number;
  extractionMode: 'model' | 'fallback' | 'empty' | 'runtime_agent';
}

export interface ExpertDiscoveryResult {
  candidates: ExpertDiscoveryCandidate[];
  meta: ExpertDiscoveryMeta;
}

@Injectable()
export class ExpertDiscoveryService {
  constructor(private readonly openAIChatService: OpenAIChatService) {}

  async discoverExperts(
    topic: string,
    limit = 10,
    userId?: number,
    traceId?: string,
  ): Promise<ExpertDiscoveryResult> {
    const normalizedTopic = topic?.trim();
    if (!normalizedTopic) {
      return {
        candidates: [],
        meta: {
          queries: [],
          resultCount: 0,
          extractionMode: 'empty',
        },
      };
    }

    return this.openAIChatService.requestPiDiscussion<ExpertDiscoveryResult>({
      action: 'discover_experts',
      payload: {
        topic: normalizedTopic,
        limit: Math.max(1, Math.min(Number(limit) || 10, 10)),
      },
      sessionId: `discussion-discovery-${Date.now()}`,
      userId,
      traceId,
      workspaceDir: 'conversations/discussion-discovery',
    });
  }
}
