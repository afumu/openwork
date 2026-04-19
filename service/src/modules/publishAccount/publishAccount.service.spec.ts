import axios from 'axios';
import { HttpException } from '@nestjs/common';
import { PublishAccountService } from './publishAccount.service';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const beforeEach: any;
declare const jest: any;

jest.mock('axios');

type AccountRecord = {
  id: number;
  userId: number;
  provider: string;
  accountName: string;
  wechatAppId: string;
  wechatAppSecretEncrypted: string;
  wechatTokenEncrypted?: string | null;
  isDefault: boolean;
  status: string;
  lastTestStatus: string;
  lastTestMessage: string | null;
  updatedAt: Date;
};

function createRepository(seed: AccountRecord[] = []) {
  let records = [...seed];
  let currentId = records.reduce((max, item) => Math.max(max, item.id), 0);

  return {
    dump: () => records,
    create: (payload: Partial<AccountRecord>) => payload,
    find: async ({ where }: any = {}) => {
      if (!where) return [...records];
      return records.filter(item =>
        Object.entries(where).every(
          ([key, value]) => (item as Record<string, unknown>)[key] === value,
        ),
      );
    },
    findOne: async ({ where }: any = {}) => {
      return (
        records.find(item =>
          Object.entries(where || {}).every(
            ([key, value]) => (item as Record<string, unknown>)[key] === value,
          ),
        ) || null
      );
    },
    save: async (payload: Partial<AccountRecord>) => {
      if (payload.id) {
        records = records.map(item =>
          item.id === payload.id
            ? ({ ...item, ...payload, updatedAt: new Date() } as AccountRecord)
            : item,
        );
        return records.find(item => item.id === payload.id);
      }

      currentId += 1;
      const next: AccountRecord = {
        id: currentId,
        provider: 'wechat_official_account',
        status: 'active',
        lastTestStatus: 'unknown',
        lastTestMessage: null,
        updatedAt: new Date(),
        isDefault: false,
        wechatAppId: '',
        wechatAppSecretEncrypted: '',
        wechatTokenEncrypted: null,
        accountName: '',
        userId: 0,
        ...payload,
      } as AccountRecord;
      records.push(next);
      return next;
    },
    update: async (where: any, partial: Partial<AccountRecord>) => {
      records = records.map(item =>
        Object.entries(where).every(
          ([key, value]) => (item as Record<string, unknown>)[key] === value,
        )
          ? ({ ...item, ...partial, updatedAt: new Date() } as AccountRecord)
          : item,
      );
      return { affected: 1 };
    },
    softDelete: async (where: any) => {
      const before = records.length;
      records = records.filter(
        item =>
          !Object.entries(where).every(
            ([key, value]) => (item as Record<string, unknown>)[key] === value,
          ),
      );
      return { affected: before - records.length };
    },
  };
}

describe('PublishAccountService', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: PublishAccountService;

  beforeEach(() => {
    repository = createRepository();
    service = new PublishAccountService(repository as any);
    jest.resetAllMocks();
  });

  it('creates the first account as default and masks secrets in list responses', async () => {
    await service.createAccount(12, {
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: false,
    });

    const list = await service.listAccounts(12);

    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);
    expect(list[0].wechatAppSecretMasked).not.toContain('secret-one');
  });

  it('keeps only one default account when a later account is promoted', async () => {
    const first = await service.createAccount(12, {
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: false,
    });
    const second = await service.createAccount(12, {
      accountName: '副号',
      wechatAppId: 'wx-app-2',
      wechatAppSecret: 'secret-two',
      isDefault: true,
    });

    const list = await service.listAccounts(12);

    expect(list.find(item => item.id === first.id)?.isDefault).toBe(false);
    expect(list.find(item => item.id === second.id)?.isDefault).toBe(true);
  });

  it('reveals secrets for the owner and blocks unrelated users', async () => {
    const account = await service.createAccount(12, {
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: false,
    });

    await expect(service.revealSecrets(13, 'user', account.id)).rejects.toBeInstanceOf(
      HttpException,
    );

    await expect(service.revealSecrets(12, 'user', account.id)).resolves.toMatchObject({
      wechatAppSecret: 'secret-one',
    });
    await expect(service.revealSecrets(99, 'admin', account.id)).resolves.toMatchObject({
      wechatAppSecret: 'secret-one',
    });
  });

  it('tests access token retrieval and records the latest test result', async () => {
    const mockedAxios = axios as any;
    mockedAxios.get.mockResolvedValue({
      data: {
        access_token: 'live-token',
      },
    } as any);

    const account = await service.createAccount(12, {
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: false,
    });

    const result = await service.testConnection(12, account.id);

    expect(result.success).toBe(true);
    expect(repository.dump()[0].lastTestStatus).toBe('success');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('appid=wx-app-1'),
      expect.any(Object),
    );
  });

  it('updates account metadata without requiring token fields', async () => {
    const account = await service.createAccount(12, {
      accountName: '主号',
      wechatAppId: 'wx-app-1',
      wechatAppSecret: 'secret-one',
      isDefault: false,
    });

    const updated = await service.updateAccount(12, {
      id: account.id,
      accountName: '新主号',
      wechatAppId: 'wx-app-2',
    });

    expect(updated.accountName).toBe('新主号');
    expect(updated.wechatAppId).toBe('wx-app-2');
  });
});
