import { post } from '@/utils/request'

export function fetchArtifactListAPI<T>(data: { groupId: number }): Promise<T> {
  return post<T>({
    url: '/openwork/artifacts/list',
    data,
  }) as Promise<T>
}

export function fetchArtifactReadAPI<T>(data: {
  groupId: number
  runId?: string
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/artifacts/read',
    data,
  }) as Promise<T>
}
