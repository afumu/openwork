import { hideString } from '@/common/utils';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { PublishAccountEntity } from './publishAccount.entity';
import { decryptPublishSecret, encryptPublishSecret } from './publishAccount.crypto';
import { CreatePublishAccountDto } from './dto/createPublishAccount.dto';
import { UpdatePublishAccountDto } from './dto/updatePublishAccount.dto';
import { PublishAccountListItem, PublishAccountSecrets } from './publishAccount.types';

@Injectable()
export class PublishAccountService {
  constructor(
    @InjectRepository(PublishAccountEntity)
    private readonly publishAccountEntity: Repository<PublishAccountEntity>,
  ) {}

  async listAccounts(userId: number): Promise<PublishAccountListItem[]> {
    const rows = await this.publishAccountEntity.find({
      where: { userId, provider: 'wechat_official_account' },
    });

    return rows
      .sort((left, right) => {
        if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .map(item => this.toListItem(item));
  }

  async createAccount(userId: number, dto: CreatePublishAccountDto) {
    const existing = await this.publishAccountEntity.find({
      where: { userId, provider: 'wechat_official_account' },
    });
    const shouldBeDefault = Boolean(dto.isDefault) || existing.length === 0;

    if (shouldBeDefault) {
      await this.clearDefaultForUser(userId);
    }

    const saved = await this.publishAccountEntity.save(
      this.publishAccountEntity.create({
        userId,
        provider: 'wechat_official_account',
        accountName: dto.accountName.trim(),
        wechatAppId: dto.wechatAppId.trim(),
        wechatAppSecretEncrypted: encryptPublishSecret(dto.wechatAppSecret.trim()),
        wechatTokenEncrypted: null,
        isDefault: shouldBeDefault,
        status: 'active',
        lastTestStatus: 'unknown',
        lastTestMessage: null,
        lastPublishedAt: null,
      }),
    );

    return this.toListItem(saved);
  }

  async updateAccount(userId: number, dto: UpdatePublishAccountDto) {
    const account = await this.requireOwnedAccount(userId, dto.id);

    if (dto.isDefault) {
      await this.clearDefaultForUser(userId, dto.id);
      account.isDefault = true;
    }

    if (dto.accountName !== undefined) account.accountName = dto.accountName.trim();
    if (dto.wechatAppId !== undefined) account.wechatAppId = dto.wechatAppId.trim();
    if (dto.wechatAppSecret !== undefined) {
      account.wechatAppSecretEncrypted = encryptPublishSecret(dto.wechatAppSecret.trim());
    }

    const saved = await this.publishAccountEntity.save(account);
    return this.toListItem(saved);
  }

  async deleteAccount(userId: number, accountId: number) {
    const account = await this.requireOwnedAccount(userId, accountId);
    await this.publishAccountEntity.softDelete({ id: account.id, userId });

    if (account.isDefault) {
      const remaining = await this.publishAccountEntity.find({
        where: { userId, provider: 'wechat_official_account' },
      });
      const nextDefault = remaining.find(item => item.id !== account.id);
      if (nextDefault) {
        nextDefault.isDefault = true;
        await this.publishAccountEntity.save(nextDefault);
      }
    }

    return '删除成功';
  }

  async setDefaultAccount(userId: number, accountId: number) {
    const account = await this.requireOwnedAccount(userId, accountId);
    await this.clearDefaultForUser(userId, account.id);
    account.isDefault = true;
    const saved = await this.publishAccountEntity.save(account);
    return this.toListItem(saved);
  }

  async revealSecrets(requesterUserId: number, requesterRole: string, accountId: number) {
    const account = await this.publishAccountEntity.findOne({ where: { id: accountId } });

    if (!account) {
      throw new HttpException('公众号账号不存在', HttpStatus.NOT_FOUND);
    }

    const isAdmin = requesterRole === 'admin' || requesterRole === 'super';
    if (!isAdmin && account.userId !== requesterUserId) {
      throw new HttpException('无权查看该公众号账号密钥', HttpStatus.FORBIDDEN);
    }

    return {
      id: account.id,
      wechatAppId: account.wechatAppId,
      wechatAppSecret: decryptPublishSecret(account.wechatAppSecretEncrypted),
    };
  }

  async getAccountForPublish(
    userId: number,
    accountId?: number,
  ): Promise<
    {
      id: number;
      accountName: string;
      isDefault: boolean;
    } & PublishAccountSecrets
  > {
    let account: PublishAccountEntity | null = null;

    if (accountId) {
      account = await this.requireOwnedAccount(userId, accountId);
    } else {
      account = await this.publishAccountEntity.findOne({
        where: { userId, isDefault: true, provider: 'wechat_official_account' },
      });
      if (!account) {
        account = await this.publishAccountEntity.findOne({
          where: { userId, provider: 'wechat_official_account' },
        });
      }
    }

    if (!account) {
      throw new HttpException('请先配置公众号发布账号', HttpStatus.BAD_REQUEST);
    }

    return {
      id: account.id,
      accountName: account.accountName,
      isDefault: account.isDefault,
      wechatAppId: account.wechatAppId,
      wechatAppSecret: decryptPublishSecret(account.wechatAppSecretEncrypted),
    };
  }

  async testConnection(userId: number, accountId: number) {
    const account = await this.getAccountForPublish(userId, accountId);
    const accessTokenUrl =
      process.env.WECHAT_ACCESS_TOKEN_URL ||
      process.env.weChatApiUrlToken ||
      'https://api.weixin.qq.com/cgi-bin/token';
    const url = `${accessTokenUrl}?grant_type=client_credential&appid=${account.wechatAppId}&secret=${account.wechatAppSecret}`;

    try {
      const response = await axios.get(url, {
        timeout: 15000,
      });
      const success = Boolean(response?.data?.access_token) && !response?.data?.errcode;
      const message = success
        ? '连接成功'
        : response?.data?.errmsg || '微信接口未返回 access_token';

      await this.publishAccountEntity.update(
        { id: account.id, userId },
        {
          lastTestStatus: success ? 'success' : 'failed',
          lastTestMessage: message,
        },
      );

      return {
        success,
        message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.publishAccountEntity.update(
        { id: account.id, userId },
        {
          lastTestStatus: 'failed',
          lastTestMessage: message,
        },
      );
      throw new HttpException(`公众号连接测试失败: ${message}`, HttpStatus.BAD_REQUEST);
    }
  }

  async markPublished(userId: number, accountId: number) {
    await this.publishAccountEntity.update(
      { id: accountId, userId },
      {
        lastPublishedAt: new Date(),
      },
    );
  }

  private async requireOwnedAccount(userId: number, accountId: number) {
    const account = await this.publishAccountEntity.findOne({
      where: { id: accountId, userId, provider: 'wechat_official_account' },
    });

    if (!account) {
      throw new HttpException('公众号账号不存在或无权访问', HttpStatus.NOT_FOUND);
    }

    return account;
  }

  private async clearDefaultForUser(userId: number, exceptId?: number) {
    const accounts = await this.publishAccountEntity.find({
      where: { userId, provider: 'wechat_official_account' },
    });

    for (const account of accounts) {
      if (exceptId && account.id === exceptId) continue;
      if (!account.isDefault) continue;
      account.isDefault = false;
      await this.publishAccountEntity.save(account);
    }
  }

  private toListItem(account: PublishAccountEntity): PublishAccountListItem {
    return {
      id: account.id,
      accountName: account.accountName,
      provider: account.provider,
      wechatAppId: account.wechatAppId,
      wechatAppSecretMasked: hideString(decryptPublishSecret(account.wechatAppSecretEncrypted)),
      isDefault: account.isDefault,
      status: account.status,
      lastTestStatus: account.lastTestStatus,
      lastTestMessage: account.lastTestMessage,
      lastPublishedAt: account.lastPublishedAt,
      updatedAt: account.updatedAt,
    };
  }
}
