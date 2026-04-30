import { post } from '@/utils/request'

export interface RuntimeWorkspaceEntry {
  kind: 'file' | 'directory'
  name: string
  path: string
  size: number
  type: string
  updatedAt: string
  runId?: string | null
  source?: string
}

export interface RuntimeWorkspaceSearchMatch {
  column: number
  line: number
  preview: string
}

export interface RuntimeWorkspaceSearchResult {
  matches: RuntimeWorkspaceSearchMatch[]
  path: string
}

export interface RuntimeWorkspaceSearchPayload {
  results: RuntimeWorkspaceSearchResult[]
  truncated: boolean
}

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

export function writeRuntimeWorkspaceFileAPI<T = RuntimeWorkspaceEntry>(data: {
  baseUpdatedAt?: string
  content: string
  groupId: number
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/write',
    data,
  }) as Promise<T>
}

export function createRuntimeWorkspaceEntryAPI<T = RuntimeWorkspaceEntry>(data: {
  content?: string
  groupId: number
  kind?: 'file' | 'directory'
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/create',
    data,
  }) as Promise<T>
}

export function renameRuntimeWorkspaceEntryAPI<T = { fromPath: string; toPath: string; entry: RuntimeWorkspaceEntry }>(data: {
  fromPath: string
  groupId: number
  toPath: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/rename',
    data,
  }) as Promise<T>
}

export interface RuntimeWorkspaceDeleteResult {
  deleted: true
  kind: 'file' | 'directory'
  path: string
  size: number
  type: string
  updatedAt: string
}

export function deleteRuntimeWorkspaceEntryAPI<T = RuntimeWorkspaceDeleteResult>(data: {
  groupId: number
  path: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/delete',
    data,
  }) as Promise<T>
}

export function searchRuntimeWorkspaceAPI<T = RuntimeWorkspaceSearchPayload>(data: {
  exclude?: string[]
  groupId: number
  include?: string[]
  query: string
}): Promise<T> {
  return post<T>({
    url: '/openwork/runtime/workspace/search',
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
