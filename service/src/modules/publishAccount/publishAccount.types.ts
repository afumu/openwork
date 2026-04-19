export interface PublishAccountListItem {
  id: number;
  accountName: string;
  provider: string;
  wechatAppId: string;
  wechatAppSecretMasked: string;
  isDefault: boolean;
  status: string;
  lastTestStatus: string;
  lastTestMessage: string | null;
  lastPublishedAt: Date | null;
  updatedAt: Date;
}

export interface PublishAccountSecrets {
  wechatAppId: string;
  wechatAppSecret: string;
}
