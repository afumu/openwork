import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OpenAIChatService } from '../aiTool/chat/chat.service';
import { PublishWechatArticleDto } from './dto/publishWechatArticle.dto';
import { PublishWechatPreviewDto } from './dto/publishWechatPreview.dto';
import { SyncWechatDraftDto } from './dto/syncWechatDraft.dto';
import { PublishAccountService } from './publishAccount.service';
import { WechatCoverService } from './wechatCover.service';
import {
  assertNoRelativeImages,
  buildPreviewMarkdownFromArtifact,
  buildWechatPublishMarkdown,
  mergeWechatDraftIntoArtifact,
} from './wechatMarkdown';
import { PublishMarkdownResult, WechatPublisher } from './wechatPublisher';

@Injectable()
export class PublishExecutionService {
  constructor(
    private readonly openAIChatService: OpenAIChatService,
    private readonly publishAccountService: PublishAccountService,
    private readonly wechatCoverService: WechatCoverService,
    private readonly wechatPublisher: WechatPublisher = new WechatPublisher(),
  ) {}

  private async resolveArtifactContent(
    userId: number,
    input: { groupId: number; runId?: string | null; path: string; markdown?: string },
    traceKey: string,
  ) {
    if (input.markdown?.trim()) {
      return {
        artifact: null,
        content: input.markdown.trim(),
        usesDraftOverride: true,
      };
    }

    const artifact = await this.openAIChatService.readArtifact(
      userId,
      input.groupId,
      input.runId || undefined,
      input.path,
      `${traceKey}:${userId}:${input.groupId}`,
    );

    return {
      artifact,
      content: String(artifact?.content || ''),
      usesDraftOverride: false,
    };
  }

  async preparePreview(userId: number, dto: PublishWechatPreviewDto) {
    const { content } = await this.resolveArtifactContent(userId, dto, 'wechat-preview');
    if (!content.trim()) {
      throw new HttpException('产物内容为空，无法生成公众号预览', HttpStatus.BAD_REQUEST);
    }

    const preview = buildPreviewMarkdownFromArtifact(dto.path, content);
    const themedPreview = await this.wechatPublisher.renderPreviewMarkdown(preview.markdown, {
      themeId: dto.themeId || 'default',
    });
    const coverSelection = await this.wechatCoverService.getCachedCoverCandidates({
      userId,
      groupId: dto.groupId,
      runId: dto.runId || null,
      artifactPath: dto.path,
      title: preview.title,
      markdown: preview.markdown,
    });

    return {
      ...preview,
      previewHtml: themedPreview.html,
      themeId: dto.themeId || 'default',
      path: dto.path,
      runId: dto.runId || null,
      coverSelection,
    };
  }

  async prepareCoverCandidates(userId: number, dto: PublishWechatPreviewDto) {
    const { content } = await this.resolveArtifactContent(userId, dto, 'wechat-cover');
    if (!content.trim()) {
      throw new HttpException('产物内容为空，无法生成公众号封面候选', HttpStatus.BAD_REQUEST);
    }

    const preview = buildPreviewMarkdownFromArtifact(dto.path, content);
    return await this.wechatCoverService.prepareCoverCandidates({
      userId,
      groupId: dto.groupId,
      runId: dto.runId || null,
      artifactPath: dto.path,
      title: preview.title,
      markdown: preview.markdown,
      refresh: dto.refreshCover,
    });
  }

  async publishToWechatDraft(userId: number, dto: PublishWechatArticleDto) {
    const preview = await this.preparePreview(userId, dto);
    assertNoRelativeImages(preview.markdown);

    const account = await this.publishAccountService.getAccountForPublish(userId, dto.accountId);
    const selectedCover = dto.coverUrl?.trim()
      ? {
          cover: dto.coverUrl.trim(),
          absoluteDirPath: undefined,
        }
      : await this.wechatCoverService.resolveSelectedCover({
          userId,
          groupId: dto.groupId,
          runId: dto.runId || null,
          artifactPath: dto.path,
          title: dto.title?.trim() || preview.title,
          markdown: preview.markdown,
          selectedCoverPath: dto.selectedCoverPath,
        });

    if (!selectedCover.cover) {
      throw new HttpException(
        '请先选择封面图，或手动填写可访问的封面图 URL',
        HttpStatus.BAD_REQUEST,
      );
    }

    const publishMarkdown = buildWechatPublishMarkdown(preview.markdown, {
      title: dto.title,
      cover: selectedCover.cover,
    });

    let published: PublishMarkdownResult;
    try {
      published = await this.wechatPublisher.publishMarkdown(publishMarkdown, {
        appId: account.wechatAppId,
        appSecret: account.wechatAppSecret,
        themeId: dto.themeId || 'default',
        absoluteDirPath: selectedCover.absoluteDirPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpException(`发布公众号草稿失败: ${message}`, HttpStatus.BAD_REQUEST);
    }

    await this.publishAccountService.markPublished(userId, account.id);

    return {
      accountId: account.id,
      accountName: account.accountName,
      mediaId: published.mediaId,
      title: dto.title || preview.title,
      themeId: dto.themeId || 'default',
      cover: selectedCover.cover,
    };
  }

  async syncDraftToArtifact(userId: number, dto: SyncWechatDraftDto) {
    const artifact = await this.openAIChatService.readArtifact(
      userId,
      dto.groupId,
      dto.runId || undefined,
      dto.path,
      `wechat-sync:${userId}:${dto.groupId}`,
    );

    const content = String(artifact?.content || '');
    if (!content.trim()) {
      throw new HttpException('原稿内容为空，无法同步发布工作副本', HttpStatus.BAD_REQUEST);
    }

    const mergedContent = mergeWechatDraftIntoArtifact(dto.path, content, dto.markdown);
    const result = await this.openAIChatService.rewriteArtifact(
      userId,
      dto.groupId,
      dto.runId || undefined,
      dto.path,
      mergedContent,
      `wechat-sync:${userId}:${dto.groupId}`,
    );

    return {
      path: dto.path,
      runId: dto.runId || null,
      size: result?.size ?? mergedContent.length,
      success: true,
      updatedAt: result?.updatedAt || new Date().toISOString(),
    };
  }
}
