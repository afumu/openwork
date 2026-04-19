import { get, post } from '@/utils/request'

export interface PublishAccountItem {
  id: number
  accountName: string
  provider: string
  wechatAppId: string
  wechatAppSecretMasked: string
  isDefault: boolean
  status: string
  lastTestStatus: string
  lastTestMessage: string | null
  lastPublishedAt: string | null
  updatedAt: string
}

export interface PublishAccountSecretPayload {
  id: number
  wechatAppId: string
  wechatAppSecret: string
}

export interface PublishWechatPreviewPayload {
  title: string
  markdown: string
  previewHtml: string
  themeId: string
  path: string
  runId: string | null
  sourceKind: string
  coverSelection: PublishWechatCoverSelectionPayload
}

export interface PublishWechatCoverCandidatePayload {
  id: string
  provider: string
  title: string
  imageUrl: string
  thumbnailUrl: string
  creator: string
  license: string
  width: number
  height: number
  score: number
  localFile: string
  relativePath: string
}

export interface PublishWechatCoverSelectionPayload {
  fromCache: boolean
  absoluteDirPath: string
  generatedAt: string | null
  provider: string
  queries: string[]
  selectedCoverPath: string
  candidates: PublishWechatCoverCandidatePayload[]
}

export interface PublishWechatResultPayload {
  accountId: number
  accountName: string
  mediaId: string
  title: string
  themeId: string
  cover: string
}

export function fetchPublishAccountListAPI<T = any>(): Promise<T> {
  return get<T>({
    url: '/publish-account/list',
  }) as Promise<T>
}

export function fetchCreatePublishAccountAPI<T = any>(data: {
  accountName: string
  wechatAppId: string
  wechatAppSecret: string
  isDefault?: boolean
}): Promise<T> {
  return post<T>({
    url: '/publish-account/create',
    data,
  }) as Promise<T>
}

export function fetchUpdatePublishAccountAPI<T = any>(data: {
  id: number
  accountName?: string
  wechatAppId?: string
  wechatAppSecret?: string
  isDefault?: boolean
}): Promise<T> {
  return post<T>({
    url: '/publish-account/update',
    data,
  }) as Promise<T>
}

export function fetchDeletePublishAccountAPI<T = any>(data: { id: number }): Promise<T> {
  return post<T>({
    url: '/publish-account/delete',
    data,
  }) as Promise<T>
}

export function fetchSetDefaultPublishAccountAPI<T = any>(data: { id: number }): Promise<T> {
  return post<T>({
    url: '/publish-account/set-default',
    data,
  }) as Promise<T>
}

export function fetchTestPublishAccountAPI<T = any>(data: { id: number }): Promise<T> {
  return post<T>({
    url: '/publish-account/test',
    data,
  }) as Promise<T>
}

export function fetchRevealPublishAccountSecretAPI<T = any>(data: { id: number }): Promise<T> {
  return post<T>({
    url: '/publish-account/reveal',
    data,
  }) as Promise<T>
}

export function fetchWechatPublishPreviewAPI<T = any>(data: {
  groupId: number
  runId?: string
  path: string
  themeId?: string
  markdown?: string
}): Promise<T> {
  return post<T>({
    url: '/publish-account/wechat/preview',
    data,
  }) as Promise<T>
}

export function fetchWechatCoverCandidatesAPI<T = any>(data: {
  groupId: number
  runId?: string
  path: string
  refreshCover?: boolean
  markdown?: string
}): Promise<T> {
  return post<T>({
    url: '/publish-account/wechat/covers',
    data,
  }) as Promise<T>
}

export function fetchWechatPublishAPI<T = any>(data: {
  groupId: number
  runId?: string
  path: string
  accountId?: number
  title?: string
  themeId?: string
  markdown?: string
  summary?: string
  coverUrl?: string
  selectedCoverPath?: string
}): Promise<T> {
  return post<T>({
    url: '/publish-account/wechat/publish',
    data,
  }) as Promise<T>
}

export function fetchWechatSyncDraftAPI<T = any>(data: {
  groupId: number
  runId?: string
  path: string
  markdown: string
}): Promise<T> {
  return post<T>({
    url: '/publish-account/wechat/sync-draft',
    data,
  }) as Promise<T>
}
