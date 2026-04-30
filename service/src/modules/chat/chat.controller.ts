import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwtAuth.guard';
import { ChatService } from './chat.service';

import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatProcessDto } from './dto/chatProcess.dto';
import { RuntimeStatusDto } from './dto/runtimeStatus.dto';
import {
  RuntimeWorkspaceCreateDto,
  RuntimeWorkspaceDeleteDto,
  RuntimeWorkspaceListDto,
  RuntimeWorkspaceReadDto,
  RuntimeWorkspaceRenameDto,
  RuntimeWorkspaceSearchDto,
  RuntimeWorkspaceWriteDto,
} from './dto/runtimeWorkspace.dto';
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

  @Post('runtime/workspace/list')
  @ApiOperation({ summary: '查询当前对话运行时工作区文件' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceList(@Body() body: RuntimeWorkspaceListDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceList(body, req);
  }

  @Post('runtime/workspace/read')
  @ApiOperation({ summary: '读取当前对话运行时工作区文件' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceRead(@Body() body: RuntimeWorkspaceReadDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceRead(body, req);
  }

  @Post('runtime/workspace/write')
  @ApiOperation({ summary: '写入当前对话运行时工作区文件' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceWrite(@Body() body: RuntimeWorkspaceWriteDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceWrite(body, req);
  }

  @Post('runtime/workspace/create')
  @ApiOperation({ summary: '创建当前对话运行时工作区文件或目录' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceCreate(@Body() body: RuntimeWorkspaceCreateDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceCreate(body, req);
  }

  @Post('runtime/workspace/rename')
  @ApiOperation({ summary: '重命名当前对话运行时工作区文件或目录' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceRename(@Body() body: RuntimeWorkspaceRenameDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceRename(body, req);
  }

  @Post('runtime/workspace/delete')
  @ApiOperation({ summary: '删除当前对话运行时工作区文件或目录' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceDelete(@Body() body: RuntimeWorkspaceDeleteDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceDelete(body, req);
  }

  @Post('runtime/workspace/search')
  @ApiOperation({ summary: '搜索当前对话运行时工作区文件内容' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  runtimeWorkspaceSearch(@Body() body: RuntimeWorkspaceSearchDto, @Req() req: Request) {
    return this.chatService.runtimeWorkspaceSearch(body, req);
  }

  @Post('tts-process')
  @ApiOperation({ summary: 'tts语音播报' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  ttsProcess(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.chatService.ttsProcess(body, req, res);
  }
}
