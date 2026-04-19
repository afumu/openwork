import { WechatPublisher } from './wechatPublisher';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

describe('WechatPublisher', () => {
  it('clears wenyan cache and retries once when publish fails with invalid credential', async () => {
    const renderAndPublish = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '40001: invalid credential, access_token is invalid or not latest, could get access_token by appid or appsecret',
        ),
      )
      .mockResolvedValueOnce('draft-media-id');
    const clearCache = jest.fn().mockResolvedValue(undefined);

    const publisher = new WechatPublisher({
      loadWrapper: async () => ({
        renderAndPublish,
        wechatPublisher: {
          clearCache,
        },
      }),
    });

    const result = await publisher.publishMarkdown('# 标题\n\n正文', {
      appId: 'wx-app-1',
      appSecret: 'secret-1',
      themeId: 'default',
    });

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(renderAndPublish).toHaveBeenCalledTimes(2);
    expect(result.mediaId).toBe('draft-media-id');
  });
});
