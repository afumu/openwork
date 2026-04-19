import { JwtAuthGuard } from '@/common/auth/jwtAuth.guard';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CreatePublishAccountDto } from './dto/createPublishAccount.dto';
import { PublishWechatArticleDto } from './dto/publishWechatArticle.dto';
import { PublishWechatPreviewDto } from './dto/publishWechatPreview.dto';
import { RevealPublishAccountSecretDto } from './dto/revealPublishAccountSecret.dto';
import { SetDefaultPublishAccountDto } from './dto/setDefaultPublishAccount.dto';
import { SyncWechatDraftDto } from './dto/syncWechatDraft.dto';
import { TestPublishAccountDto } from './dto/testPublishAccount.dto';
import { UpdatePublishAccountDto } from './dto/updatePublishAccount.dto';
import { PublishAccountService } from './publishAccount.service';
import { PublishExecutionService } from './publishExecution.service';

@ApiTags('publish-account')
@Controller('publish-account')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PublishAccountController {
  constructor(
    private readonly publishAccountService: PublishAccountService,
    private readonly publishExecutionService: PublishExecutionService,
  ) {}

  @Get('list')
  @ApiOperation({ summary: '查询当前用户的发布账号列表' })
  async list(@Req() req: Request) {
    return await this.publishAccountService.listAccounts(req.user.id);
  }

  @Post('create')
  @ApiOperation({ summary: '新增发布账号' })
  async create(@Req() req: Request, @Body() body: CreatePublishAccountDto) {
    return await this.publishAccountService.createAccount(req.user.id, body);
  }

  @Post('update')
  @ApiOperation({ summary: '更新发布账号' })
  async update(@Req() req: Request, @Body() body: UpdatePublishAccountDto) {
    return await this.publishAccountService.updateAccount(req.user.id, body);
  }

  @Post('delete')
  @ApiOperation({ summary: '删除发布账号' })
  async delete(@Req() req: Request, @Body() body: SetDefaultPublishAccountDto) {
    return await this.publishAccountService.deleteAccount(req.user.id, body.id);
  }

  @Post('set-default')
  @ApiOperation({ summary: '设为默认发布账号' })
  async setDefault(@Req() req: Request, @Body() body: SetDefaultPublishAccountDto) {
    return await this.publishAccountService.setDefaultAccount(req.user.id, body.id);
  }

  @Post('test')
  @ApiOperation({ summary: '测试发布账号连接' })
  async test(@Req() req: Request, @Body() body: TestPublishAccountDto) {
    return await this.publishAccountService.testConnection(req.user.id, body.id);
  }

  @Post('reveal')
  @ApiOperation({ summary: '查看发布账号明文密钥' })
  async reveal(@Req() req: Request, @Body() body: RevealPublishAccountSecretDto) {
    return await this.publishAccountService.revealSecrets(req.user.id, req.user.role, body.id);
  }

  @Post('wechat/preview')
  @ApiOperation({ summary: '生成公众号预览稿' })
  async preview(@Req() req: Request, @Body() body: PublishWechatPreviewDto) {
    return await this.publishExecutionService.preparePreview(req.user.id, body);
  }

  @Post('wechat/covers')
  @ApiOperation({ summary: '搜索公众号封面候选' })
  async covers(@Req() req: Request, @Body() body: PublishWechatPreviewDto) {
    return await this.publishExecutionService.prepareCoverCandidates(req.user.id, body);
  }

  @Post('wechat/publish')
  @ApiOperation({ summary: '发布公众号草稿' })
  async publish(@Req() req: Request, @Body() body: PublishWechatArticleDto) {
    return await this.publishExecutionService.publishToWechatDraft(req.user.id, body);
  }

  @Post('wechat/sync-draft')
  @ApiOperation({ summary: '将发布工作副本同步回原稿' })
  async syncDraft(@Req() req: Request, @Body() body: SyncWechatDraftDto) {
    return await this.publishExecutionService.syncDraftToArtifact(req.user.id, body);
  }
}
