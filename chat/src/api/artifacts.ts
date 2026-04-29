import { post } from '@/utils/request'

export function fetchArtifactListAPI<T>(data: { groupId: number }): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/list',
    data,
  }) as Promise<T>
}

export function fetchArtifactReadAPI<T>(data: {
  groupId: number
  runId?: string
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/read',
    data,
  }) as Promise<T>
}
