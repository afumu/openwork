import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwtAuth.guard';
import { ChatService } from './chat.service';

import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatProcessDto } from './dto/chatProcess.dto';
import { RuntimeStatusDto } from './dto/runtimeStatus.dto';
import { StopChatDto } from './dto/stopChat.dto';

@ApiTags('openwork')
@Controller('openwork')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat-process')
  @ApiOperation({ summary: 'gpt聊天对话' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  chatProcess(@Body() body: ChatProcessDto, @Req() req: Request, @Res() res: Response) {
    return this.chatService.chatProcess(body, req, res);
  }

  @Post('chat-stop')
  @ApiOperation({ summary: '停止当前聊天流' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  chatStop(@Body() body: StopChatDto, @Req() req: Request) {
    return this.chatService.stopChat(body, req);
  }

  @Post('runtime/status')
  @ApiOperation({ summary: '查询当前对话运行时状态' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeStatus(@Body() body: RuntimeStatusDto, @Req() req: Request) {
    return this.chatService.runtimeStatus(body, req);
  }

  @Post('tts-process')
  @ApiOperation({ summary: 'tts语音播报' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  ttsProcess(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.chatService.ttsProcess(body, req, res);
  }
}
