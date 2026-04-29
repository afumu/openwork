import { post } from '@/utils/request'

export function fetchRuntimeStatusAPI<T>(data: { groupId: number }): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/status',
    data,
  }) as Promise<T>
}

export function fetchRuntimeWorkspaceListAPI<T>(data: { groupId: number }): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/list',
    data,
  }) as Promise<T>
}

export function fetchRuntimeWorkspaceReadAPI<T>(data: {
  groupId: number
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/read',
    data,
  }) as Promise<T>
}

export function executeRuntimeCommandAPI<T>(data: {
  command: string
  cwd?: string
  groupId: number
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/exec',
    data,
  }) as Promise<T>
}
