declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

import { HttpException } from '@nestjs/common';
import { ChatGroupService } from './chatGroup.service';

describe('ChatGroupService', () => {
  const createReq = () => ({ user: { id: 7 } } as any);

  it('merges incomplete request modelConfig with base config before creating a group', async () => {
    const save = jest.fn().mockResolvedValue({ id: 101 });
    const service = new ChatGroupService(
      { save } as any,
      { findOne: jest.fn() } as any,
      {
        getBaseConfig: jest.fn().mockResolvedValue({
          modelInfo: {
            model: 'gpt-4o-mini',
            modelName: 'GPT-4o Mini',
            deductType: 1,
            deduct: 1,
          },
        }),
        getModelDetailByName: jest.fn().mockResolvedValue({
          modelName: 'GPT-4o Mini',
          deductType: 1,
          deduct: 1,
          isFileUpload: 0,
          isImageUpload: 1,
          isNetworkSearch: 1,
          deepThinkingType: 0,
          isMcpTool: 0,
        }),
      } as any,
    );

    const result = await service.create(
      {
        appId: 0,
        modelConfig: {
          modelInfo: {
            isNetworkSearch: 0,
          },
        },
      } as any,
      createReq(),
    );

    expect(result).toEqual({ id: 101 });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        config: expect.any(String),
      }),
    );

    const savedConfig = JSON.parse(save.mock.calls[0][0].config);
    expect(savedConfig.modelInfo.model).toBe('gpt-4o-mini');
    expect(savedConfig.modelInfo.modelName).toBe('GPT-4o Mini');
  });

  it('throws a clear error when no usable model config exists', async () => {
    const service = new ChatGroupService(
      { save: jest.fn() } as any,
      { findOne: jest.fn() } as any,
      {
        getBaseConfig: jest.fn().mockResolvedValue(undefined),
        getModelDetailByName: jest.fn(),
      } as any,
    );

    await expect(service.create({ appId: 0 } as any, createReq())).rejects.toMatchObject({
      message: '当前缺少可用的对话模型配置，请刷新后重试或联系管理员配置默认模型！',
    });
  });
});
