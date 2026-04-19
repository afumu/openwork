import { BaseEntity } from 'src/common/entity/baseEntity';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'user_publish_accounts' })
@Index('idx_user_publish_accounts_user_provider', ['userId', 'provider'])
export class PublishAccountEntity extends BaseEntity {
  @Column({ comment: '所属用户 ID' })
  userId: number;

  @Column({ length: 64, default: 'wechat_official_account', comment: '发布渠道类型' })
  provider: string;

  @Column({ length: 120, comment: '账号名称' })
  accountName: string;

  @Column({ length: 128, comment: '微信公众号 AppId' })
  wechatAppId: string;

  @Column({ type: 'text', comment: '加密后的微信公众号 AppSecret' })
  wechatAppSecretEncrypted: string;

  @Column({ type: 'text', nullable: true, comment: '兼容旧数据保留的微信公众号 Token' })
  wechatTokenEncrypted: string | null;

  @Column({ default: false, comment: '是否为默认账号' })
  isDefault: boolean;

  @Column({ length: 32, default: 'active', comment: '账号状态' })
  status: string;

  @Column({ length: 32, default: 'unknown', comment: '最近一次测试状态' })
  lastTestStatus: string;

  @Column({ type: 'text', nullable: true, comment: '最近一次测试说明' })
  lastTestMessage: string | null;

  @Column({ type: 'datetime', nullable: true, comment: '最近一次发布时间' })
  lastPublishedAt: Date | null;
}
