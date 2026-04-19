import { PublishExecutionService } from './publishExecution.service';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const beforeEach: any;
declare const jest: any;

describe('PublishExecutionService', () => {
  let artifactReader: { readArtifact: any; rewriteArtifact: any };
  let accountService: { getAccountForPublish: any; markPublished: any };
  let coverService: {
    getCachedCoverCandidates: any;
    prepareCoverCandidates: any;
    resolveSelectedCover: any;
  };
  let publisher: { publishMarkdown: any; renderPreviewMarkdown: any };
  let service: PublishExecutionService;

  beforeEach(() => {
    artifactReader = {
      readArtifact: jest.fn(),
      rewriteArtifact: jest.fn(),
    };
    accountService = {
      getAccountForPublish: jest.fn(),
      markPublished: jest.fn(),
    };
    coverService = {
      getCachedCoverCandidates: jest.fn(),
      prepareCoverCandidates: jest.fn(),
      resolveSelectedCover: jest.fn(),
    };
    publisher = {
      publishMarkdown: jest.fn(),
      renderPreviewMarkdown: jest.fn(),
    };

    service = new PublishExecutionService(
      artifactReader as any,
      accountService as any,
      coverService as any,
      publisher as any,
    );

    const coverSelection = {
      fromCache: false,
      absoluteDirPath: '/tmp/wechat-cover-cache/user-12/group-99/writer',
      generatedAt: '2026-04-19T00:00:00.000Z',
      provider: 'openverse',
      queries: ['robotics industry'],
      selectedCoverPath: 'cover_candidates/01-openverse-robotics.jpg',
      candidates: [
        {
          id: 'img-1',
          provider: 'openverse',
          title: 'Robotics industry',
          imageUrl: 'https://example.com/robotics.jpg',
          thumbnailUrl: 'https://example.com/robotics-thumb.jpg',
          creator: 'Jane',
          license: 'cc by',
          width: 1200,
          height: 675,
          score: 10,
          localFile:
            '/tmp/wechat-cover-cache/user-12/group-99/writer/cover_candidates/01-openverse-robotics.jpg',
          relativePath: 'cover_candidates/01-openverse-robotics.jpg',
        },
      ],
    };
    coverService.getCachedCoverCandidates.mockResolvedValue(coverSelection);
    coverService.prepareCoverCandidates.mockResolvedValue(coverSelection);
    coverService.resolveSelectedCover.mockResolvedValue({
      absoluteDirPath: '/tmp/wechat-cover-cache/user-12/group-99/writer',
      cover: 'cover_candidates/01-openverse-robotics.jpg',
    });
    publisher.renderPreviewMarkdown.mockResolvedValue({
      html: '<section id="wenyan"><h1>机器人行业正在重估</h1></section>',
    });
  });

  it('extracts the writer body from 08_writer.md for preview', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# Writer',
        '',
        '## 完整稿件正文',
        '',
        '# 机器人行业正在重估',
        '',
        '这里是正文第一段。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
        '',
        '- 说明',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 99,
      runId: 'run-1',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('机器人行业正在重估');
    expect(preview.markdown).toContain('# 机器人行业正在重估');
    expect(preview.markdown).not.toContain('稿中使用的关键财务');
    expect(preview.previewHtml).toContain('<section id="wenyan">');
    expect(preview.themeId).toBe('default');
    expect(preview.coverSelection.selectedCoverPath).toBe(
      'cover_candidates/01-openverse-robotics.jpg',
    );
  });

  it('renders preview html with the requested wenyan theme', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: ['## 完整稿件正文', '', '# 主题预览测试', '', '- 列表一', '- 列表二'].join('\n'),
      type: 'markdown',
    });
    publisher.renderPreviewMarkdown.mockResolvedValue({
      html: '<section id="wenyan" data-theme="rainbow"><h1>主题预览测试</h1></section>',
    });

    const preview = await service.preparePreview(12, {
      groupId: 99,
      path: '08_writer.md',
      themeId: 'rainbow',
    });

    expect(publisher.renderPreviewMarkdown).toHaveBeenCalledWith(
      expect.stringContaining('# 主题预览测试'),
      { themeId: 'rainbow' },
    );
    expect(preview.themeId).toBe('rainbow');
    expect(preview.previewHtml).toContain('data-theme="rainbow"');
  });

  it('uses draft markdown overrides instead of rereading the artifact body for preview', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: ['## 完整稿件正文', '', '# 原始标题', '', '原始正文。'].join('\n'),
      type: 'markdown',
    });
    publisher.renderPreviewMarkdown.mockResolvedValue({
      html: '<section id="wenyan"><h1>工作副本标题</h1><p>工作副本正文。</p></section>',
    });

    const preview = await service.preparePreview(12, {
      groupId: 99,
      path: '08_writer.md',
      markdown: '# 工作副本标题\n\n工作副本正文。',
      themeId: 'default',
    });

    expect(preview.title).toBe('工作副本标题');
    expect(preview.markdown).toBe('# 工作副本标题\n\n工作副本正文。');
    expect(publisher.renderPreviewMarkdown).toHaveBeenCalledWith(
      '# 工作副本标题\n\n工作副本正文。',
      {
        themeId: 'default',
      },
    );
  });

  it('accepts writer body when the title is not the first line of the section', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# Writer',
        '',
        '## 完整稿件正文',
        '',
        '导语说明：以下内容为可直接发布稿件。',
        '',
        '# 机器人行业正在重估',
        '',
        '这里是正文第一段。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
        '',
        '- 说明',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 99,
      runId: 'run-1',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('机器人行业正在重估');
    expect(preview.markdown).toContain('导语说明：以下内容为可直接发布稿件。');
    expect(preview.markdown).toContain('# 机器人行业正在重估');
    expect(preview.markdown).not.toContain('稿中使用的关键财务');
  });

  it('extracts writer title from bold title blocks used in real openwork drafts', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# 08 Writer｜独家深度稿',
        '',
        '## 完整稿件正文',
        '',
        '**标题：**  ',
        '**《伊朗—美国冲突若升级：油价只是第一枪，真正的战场在制造业利润表》**',
        '',
        '如果伊朗与美国冲突演化为持续军事对抗，市场第一反应通常是“油价要涨”。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(1, {
      groupId: 98,
      runId: '20260416_213000_iran-us-war-impact',
      path: '20260416_213000_iran-us-war-impact/08_writer.md',
    });

    expect(preview.title).toBe('伊朗—美国冲突若升级：油价只是第一枪，真正的战场在制造业利润表');
    expect(preview.markdown).toContain('**标题：**');
  });

  it('accepts legacy writer sections that use a level-1 正文 heading', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# Writer',
        '',
        '# 完整稿件正文',
        '',
        '# 一篇旧格式测试稿',
        '',
        '这是正文第一段。',
        '',
        '### 小节标题',
        '',
        '这是正文第二段。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
        '',
        '- 这部分不应进入预览',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 55,
      runId: 'legacy-run',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('一篇旧格式测试稿');
    expect(preview.markdown).toContain('### 小节标题');
    expect(preview.markdown).not.toContain('这部分不应进入预览');
  });

  it('syncs edited publish markdown back into the writer body section only', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# 08 Writer｜独家深度稿',
        '',
        '## 核心写作提纲',
        '',
        '- 原始提纲',
        '',
        '## 完整稿件正文',
        '',
        '# 原始标题',
        '',
        '原始正文第一段。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
        '',
        '- 原始事实说明',
      ].join('\n'),
      type: 'markdown',
    });
    artifactReader.rewriteArtifact.mockResolvedValue({
      path: '08_writer.md',
      success: true,
      updatedAt: '2026-04-19T10:00:00.000Z',
    });

    const result = await service.syncDraftToArtifact(12, {
      groupId: 99,
      runId: 'run-1',
      path: '08_writer.md',
      markdown: '# 新标题\n\n这里是新的发布正文。',
    });

    expect(artifactReader.rewriteArtifact).toHaveBeenCalledWith(
      12,
      99,
      'run-1',
      '08_writer.md',
      expect.stringContaining('## 完整稿件正文\n\n# 新标题\n\n这里是新的发布正文。'),
      expect.any(String),
    );
    expect(artifactReader.rewriteArtifact).toHaveBeenCalledWith(
      12,
      99,
      'run-1',
      '08_writer.md',
      expect.not.stringContaining('原始正文第一段。'),
      expect.any(String),
    );
    expect(result.path).toBe('08_writer.md');
    expect(result.updatedAt).toBe('2026-04-19T10:00:00.000Z');
  });

  it('accepts writer sections that use a plain 正文 heading', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# 08 Writer',
        '',
        '## 写稿前素材准备检查',
        '- 已读取素材',
        '',
        '# 正文',
        '',
        '## 自动驾驶的真相：L4 不再是技术展示，而是“运营战争”',
        '',
        '过去几年，自动驾驶行业最常见的误判，是把它当成一次线性的技术升级。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
        '',
        '- 这部分不应进入预览',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 122,
      runId: 'legacy-body',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('自动驾驶的真相：L4 不再是技术展示，而是“运营战争”');
    expect(preview.markdown).toContain('过去几年，自动驾驶行业最常见的误判');
    expect(preview.markdown).not.toContain('这部分不应进入预览');
  });

  it('falls back to the whole file when a legacy writer artifact is already a finished article', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# 从“冲突标题”到“资产重估”：美伊军事对抗如何改写资本市场逻辑',
        '## ——一份关于能源、货币、信用与盈利的独家深度框架',
        '',
        '当地缘政治进入高压状态，市场最先反应的，往往不是事实全貌，而是情绪最强的那一部分。',
        '',
        '## 一、冲突冲击资本市场的五级传导链',
        '',
        '### 第一级：能源风险溢价抬升',
        '',
        '中东冲突首先击中原油定价。',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 73,
      runId: 'legacy-full-article',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('从“冲突标题”到“资产重估”：美伊军事对抗如何改写资本市场逻辑');
    expect(preview.markdown).toContain('## 一、冲突冲击资本市场的五级传导链');
    expect(preview.markdown).toContain('### 第一级：能源风险溢价抬升');
  });

  it('extracts title from standalone bold lines used by some historical writer drafts', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '## 完整稿件正文',
        '',
        '**《流程断点之后，先别急着“宣布完成”》**',
        '',
        '这次“刚刚断了一下、需要把剩余流程跑完”的任务，眼下最重要的不是速度，而是边界。',
        '',
        '## 稿中使用的关键财务、竞争、利益关联、PSC 事实说明',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 73,
      runId: 'historical-bold-title',
      path: '08_writer.md',
    });

    expect(preview.title).toBe('流程断点之后，先别急着“宣布完成”');
    expect(preview.markdown).toContain('这次“刚刚断了一下、需要把剩余流程跑完”的任务');
  });

  it('extracts a fallback title from degraded writer templates that only reference the task topic', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# Writer',
        '',
        '## 完整稿件正文',
        '',
        '- 完整稿件正文：围绕“请整理一份关于中东局势对全球资本市场影响的研究分析，先走 OpenWork 研究流程。”，本文先确认可见事实和来源边界，再分析其对产业、资本与竞争格局的影响。',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 53,
      runId: 'degraded-template',
      path: '08_writer.md',
    });

    expect(preview.title).toBe(
      '请整理一份关于中东局势对全球资本市场影响的研究分析，先走 OpenWork 研究流程。',
    );
    expect(preview.markdown).toContain(
      '完整稿件正文：围绕“请整理一份关于中东局势对全球资本市场影响的研究分析',
    );
  });

  it('extracts the report body from a formal draft artifact', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# 机器人行业正在重估',
        '',
        '- 生成时间：2026-04-18T00:00:00.000Z',
        '',
        '## 分析报告',
        '',
        '这里是正式稿正文。',
        '',
        '## 审计附录',
        '',
        '- 风险提示',
      ].join('\n'),
      type: 'markdown',
    });

    const preview = await service.preparePreview(12, {
      groupId: 99,
      path: '99_机器人行业_正式稿.md',
    });

    expect(preview.title).toBe('机器人行业正在重估');
    expect(preview.markdown).toContain('这里是正式稿正文。');
    expect(preview.markdown).not.toContain('审计附录');
  });

  it('publishes the prepared markdown through the account-specific publisher', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: [
        '# Writer',
        '',
        '## 完整稿件正文',
        '',
        '# 机器人行业正在重估',
        '',
        '这里是正文第一段。',
      ].join('\n'),
      type: 'markdown',
    });
    accountService.getAccountForPublish.mockResolvedValue({
      id: 7,
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: true,
    });
    publisher.publishMarkdown.mockResolvedValue({
      mediaId: 'draft-media-id',
    });

    const result = await service.publishToWechatDraft(12, {
      accountId: 7,
      groupId: 99,
      path: '08_writer.md',
      themeId: 'default',
      title: '手动标题',
    });

    expect(publisher.publishMarkdown).toHaveBeenCalledWith(
      expect.stringContaining('title: 手动标题'),
      expect.objectContaining({
        appId: 'wx-app-1',
        appSecret: 'secret-one',
        themeId: 'default',
        absoluteDirPath: '/tmp/wechat-cover-cache/user-12/group-99/writer',
      }),
    );
    expect(result.mediaId).toBe('draft-media-id');
    expect(result.cover).toBe('cover_candidates/01-openverse-robotics.jpg');
  });

  it('uses a manual cover URL before cached local covers', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: ['## 完整稿件正文', '', '# 手动封面测试', '', '这里是正文第一段。'].join('\n'),
      type: 'markdown',
    });
    accountService.getAccountForPublish.mockResolvedValue({
      id: 7,
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: true,
    });
    publisher.publishMarkdown.mockResolvedValue({
      mediaId: 'draft-media-id',
    });

    await service.publishToWechatDraft(12, {
      accountId: 7,
      groupId: 99,
      path: '08_writer.md',
      coverUrl: 'https://example.com/manual-cover.jpg',
    });

    expect(coverService.resolveSelectedCover).not.toHaveBeenCalled();
    expect(publisher.publishMarkdown).toHaveBeenCalledWith(
      expect.stringContaining('cover: https://example.com/manual-cover.jpg'),
      expect.objectContaining({
        absoluteDirPath: undefined,
      }),
    );
  });

  it('searches cover candidates separately from preview generation', async () => {
    artifactReader.readArtifact.mockResolvedValue({
      content: ['## 完整稿件正文', '', '# 封面搜索测试', '', '这里是正文第一段。'].join('\n'),
      type: 'markdown',
    });

    const result = await service.prepareCoverCandidates(12, {
      groupId: 99,
      path: '08_writer.md',
      refreshCover: true,
    });

    expect(coverService.prepareCoverCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 12,
        groupId: 99,
        title: '封面搜索测试',
        refresh: true,
      }),
    );
    expect(result.selectedCoverPath).toBe('cover_candidates/01-openverse-robotics.jpg');
  });
});
