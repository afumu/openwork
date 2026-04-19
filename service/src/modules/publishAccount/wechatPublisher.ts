export interface PublishMarkdownOptions {
  appId: string;
  appSecret: string;
  themeId?: string;
  absoluteDirPath?: string;
}

export interface RenderPreviewOptions {
  themeId?: string;
}

export interface PublishMarkdownResult {
  mediaId: string;
}

export interface RenderPreviewResult {
  html: string;
}

type RenderAndPublish = (
  markdown: string,
  options: Record<string, unknown>,
  resolver: (inputContent: string) => Promise<{ content: string; absoluteDirPath: string }>,
) => Promise<string>;

interface WenyanWechatPublisherCache {
  clearCache?: () => Promise<void>;
}

interface WrapperModule {
  renderAndPublish?: RenderAndPublish;
  getGzhContent?: (
    content: string,
    themeId: string,
    hlThemeId: string,
    isMacStyle?: boolean,
    isAddFootnote?: boolean,
  ) => Promise<{ content: string }>;
  wechatPublisher?: WenyanWechatPublisherCache;
}

interface WechatPublisherDeps {
  loadWrapper?: () => Promise<WrapperModule>;
}

export class WechatPublisher {
  constructor(private readonly deps: WechatPublisherDeps = {}) {}

  private async loadWrapper() {
    if (this.deps.loadWrapper) {
      return await this.deps.loadWrapper();
    }

    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<WrapperModule>;
    return await dynamicImport('@wenyan-md/core/wrapper');
  }

  private isInvalidAccessTokenError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /40001\b/u.test(message) || /invalid credential/u.test(message);
  }

  async renderPreviewMarkdown(
    markdown: string,
    options: RenderPreviewOptions = {},
  ): Promise<RenderPreviewResult> {
    let getGzhContent: WrapperModule['getGzhContent'];
    try {
      ({ getGzhContent } = await this.loadWrapper());
    } catch (error) {
      throw new Error(
        `未安装 @wenyan-md/core，无法生成公众号主题预览。${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!getGzhContent) {
      throw new Error('未找到 @wenyan-md/core/wrapper.getGzhContent，无法生成公众号主题预览。');
    }

    const rendered = await getGzhContent(
      markdown,
      options.themeId || 'default',
      'solarized-light',
      true,
      true,
    );

    return {
      html: rendered.content,
    };
  }

  async publishMarkdown(
    markdown: string,
    options: PublishMarkdownOptions,
  ): Promise<PublishMarkdownResult> {
    let renderAndPublish: WrapperModule['renderAndPublish'];
    let wechatPublisher: WenyanWechatPublisherCache | undefined;

    try {
      ({ renderAndPublish, wechatPublisher } = await this.loadWrapper());
    } catch (error) {
      throw new Error(
        `未安装 @wenyan-md/core，无法执行真实公众号发布。${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!renderAndPublish) {
      throw new Error('未找到 @wenyan-md/core/wrapper.renderAndPublish，无法执行真实公众号发布。');
    }

    const previousAppId = process.env.WECHAT_APP_ID;
    const previousAppSecret = process.env.WECHAT_APP_SECRET;
    process.env.WECHAT_APP_ID = options.appId;
    process.env.WECHAT_APP_SECRET = options.appSecret;

    try {
      const publishOnce = async () =>
        await renderAndPublish(
          markdown,
          {
            theme: options.themeId || 'default',
            highlight: 'solarized-light',
            macStyle: true,
            footnote: true,
          },
          async (inputContent: string) => ({
            content: inputContent,
            absoluteDirPath: options.absoluteDirPath || process.cwd(),
          }),
        );

      let mediaId: string;
      try {
        mediaId = await publishOnce();
      } catch (error) {
        if (!this.isInvalidAccessTokenError(error) || !wechatPublisher?.clearCache) {
          throw error;
        }
        await wechatPublisher.clearCache();
        mediaId = await publishOnce();
      }

      return {
        mediaId,
      };
    } finally {
      process.env.WECHAT_APP_ID = previousAppId;
      process.env.WECHAT_APP_SECRET = previousAppSecret;
    }
  }
}
