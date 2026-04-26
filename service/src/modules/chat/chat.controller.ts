import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwtAuth.guard';
import { ChatService } from './chat.service';

import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatProcessDto } from './dto/chatProcess.dto';
import { DiscussionTurnDto } from './dto/discussionTurn.dto';
import { DiscoverExpertsDto } from './dto/discoverExperts.dto';
import { ListArtifactsDto } from './dto/listArtifacts.dto';
import { ReadArtifactDto } from './dto/readArtifact.dto';
import { RuntimeStatusDto } from './dto/runtimeStatus.dto';
import { StopChatDto } from './dto/stopChat.dto';
import { ExpertDiscoveryService } from './expertDiscovery.service';
import { GroupDiscussionService } from './groupDiscussion.service';

@ApiTags('openwork')
@Controller('openwork')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly expertDiscoveryService: ExpertDiscoveryService,
    private readonly groupDiscussionService: GroupDiscussionService,
  ) {}

  @Post('chat-process')
  @ApiOperation({ summary: 'gpt聊天对话' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  chatProcess(@Body() body: ChatProcessDto, @Req() req: Request, @Res() res: Response) {
    return this.chatService.chatProcess(body, req, res);
  }

  @Post('chat-stop')
  @ApiOperation({ summary: '停止当前聊天流与 PI Agent 会话' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  chatStop(@Body() body: StopChatDto, @Req() req: Request) {
    return this.chatService.stopChat(body, req);
  }

  @Post('artifacts/list')
  @ApiOperation({ summary: '查询当前对话产物列表' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listArtifacts(@Body() body: ListArtifactsDto, @Req() req: Request) {
    return this.chatService.listArtifacts(body, req);
  }

  @Post('artifacts/read')
  @ApiOperation({ summary: '读取当前对话产物文件' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  readArtifact(@Body() body: ReadArtifactDto, @Req() req: Request) {
    return this.chatService.readArtifact(body, req);
  }

  @Post('runtime/status')
  @ApiOperation({ summary: '查询当前对话运行时容器状态' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeStatus(@Body() body: RuntimeStatusDto, @Req() req: Request) {
    return this.chatService.runtimeStatus(body, req);
  }

  @Post('discover-experts')
  @ApiOperation({ summary: '基于联网搜索发现真实专家候选人' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async discoverExperts(@Body() body: DiscoverExpertsDto, @Req() req: Request) {
    return this.expertDiscoveryService.discoverExperts(
      body?.topic,
      Number(body?.limit || 10),
      req?.user?.id,
      req?.headers?.['x-request-id'] as string | undefined,
    );
  }

  @Post('discussion-turn')
  @ApiOperation({ summary: '生成专家讨论下一轮真实发言' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async discussionTurn(@Body() body: DiscussionTurnDto, @Req() req: Request) {
    return this.groupDiscussionService.generateTurn(
      body,
      req?.user?.id,
      req?.headers?.['x-request-id'] as string | undefined,
    );
  }

  @Post('tts-process')
  @ApiOperation({ summary: 'tts语音播报' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  ttsProcess(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.chatService.ttsProcess(body, req, res);
  }
}
