declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

jest.mock('../aiTool/chat/chat.service', () => ({
  OpenAIChatService: class OpenAIChatService {},
}));

import { ExpertDiscoveryService } from './expertDiscovery.service';

describe('ExpertDiscoveryService', () => {
  it('routes expert discovery into the PI discussion runtime', async () => {
    const openAIChatService = {
      requestPiDiscussion: jest.fn().mockResolvedValue({
        candidates: [
          {
            id: 'expert-sam',
            name: 'Sam Altman',
            identity: 'OpenAI CEO',
            organization: 'OpenAI',
            expertise: ['AI 平台'],
            perspective: '技术 / 产品',
            stance: '审慎中立',
            recommendationReason: '适合分析资本开支。',
            evidenceLabel: '资料充分',
            evidenceScore: 95,
            prominenceScore: 97,
            professionalScore: 94,
            tier: '优选专家',
            recommended: true,
            topicTags: ['AI'],
            personaPrompt: '你现在扮演专家代理 Sam Altman。',
          },
        ],
        meta: {
          queries: ['AI 专家 观点 分析'],
          resultCount: 8,
          extractionMode: 'model',
        },
      }),
    };
    const service = new ExpertDiscoveryService(openAIChatService as any);

    const result = await service.discoverExperts('讨论 AI 资本开支变化', 10, 7, 'trace-1');

    expect(openAIChatService.requestPiDiscussion).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'discover_experts',
        payload: {
          topic: '讨论 AI 资本开支变化',
          limit: 10,
        },
        userId: 7,
        traceId: 'trace-1',
      }),
    );
    expect(result.meta.extractionMode).toBe('model');
    expect(result.candidates[0].personaPrompt).toContain('Sam Altman');
  });

  it('does not call PI when topic is empty', async () => {
    const openAIChatService = {
      requestPiDiscussion: jest.fn(),
    };
    const service = new ExpertDiscoveryService(openAIChatService as any);

    const result = await service.discoverExperts('   ');

    expect(openAIChatService.requestPiDiscussion).not.toHaveBeenCalled();
    expect(result.meta.extractionMode).toBe('empty');
    expect(result.candidates).toHaveLength(0);
  });
});
