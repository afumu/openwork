import { Body, Controller, Headers, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AgentModelProxyService } from '../aiTool/chat/agentModelProxy.service';
import {
  InternalSearchNewsItem,
  NetSearchService,
  type WebSearchCapabilityProfile,
} from '../aiTool/search/netSearch.service';
import { isInternalSearchTokenValid } from '../aiTool/search/internalSearchAuth';
import { RedisCacheService } from '../redisCache/redisCache.service';

type InternalSearchBody = {
  topic?: string;
  limit?: number;
  scenario?: 'chat' | 'research';
  depth?: 'quick' | 'balanced' | 'deep';
};

@ApiTags('openwork-internal')
@Controller('openwork/internal')
export class ChatInternalController {
  constructor(
    private readonly agentModelProxyService: AgentModelProxyService,
    private readonly netSearchService: NetSearchService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  @Post('model-proxy/v1/chat/completions')
  @ApiOperation({ summary: 'PI runtime internal model proxy' })
  async internalModelProxy(
    @Body() body: Record<string, any>,
    @Headers('authorization') authorization = '',
    @Res() res: Response,
  ) {
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedException('missing internal model proxy token');
    }

    await this.agentModelProxyService.proxyChatCompletions(token, body, res);
  }

  @Post('search')
  @ApiOperation({ summary: 'PI runtime internal host search bridge' })
  async internalSearch(
    @Body() body: InternalSearchBody,
    @Headers('x-openwork-internal-token') internalToken?: string,
  ): Promise<{ items: InternalSearchNewsItem[] }> {
    const topic = body?.topic?.trim();
    if (!topic) {
      return { items: [] };
    }

    const jwtSecret = await this.redisCacheService.getJwtSecret();
    if (!isInternalSearchTokenValid(internalToken || '', jwtSecret)) {
      throw new UnauthorizedException('invalid internal search token');
    }

    const scenario = body?.scenario === 'research' ? 'research' : 'chat';
    const items =
      scenario === 'research'
        ? await this.netSearchService.fetchInternalNewsItems(topic, Number(body?.limit || 12), {
            depth: body?.depth,
          })
        : await this.netSearchService.fetchInternalSearchItems(topic, {
            limit: Number(body?.limit || 12),
            scenario,
            depth: body?.depth,
          });
    return { items };
  }

  @Post('search/profile')
  @ApiOperation({ summary: 'PI runtime search capability profile' })
  async internalSearchProfile(
    @Body() body: { scenario?: 'chat' | 'research' },
    @Headers('x-openwork-internal-token') internalToken?: string,
  ): Promise<{ profile: WebSearchCapabilityProfile }> {
    const jwtSecret = await this.redisCacheService.getJwtSecret();
    if (!isInternalSearchTokenValid(internalToken || '', jwtSecret)) {
      throw new UnauthorizedException('invalid internal search token');
    }

    const scenario = body?.scenario === 'research' ? 'research' : 'chat';
    return {
      profile: await this.netSearchService.getWebSearchCapabilityProfile(scenario),
    };
  }
}
