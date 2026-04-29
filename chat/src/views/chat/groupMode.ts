export type GroupType = 'chat' | 'project'

export function normalizeGroupType(groupType?: unknown): GroupType {
  return groupType === 'project' ? 'project' : 'chat'
}

export function isProjectGroup(group?: { groupType?: unknown } | null): boolean {
  return normalizeGroupType(group?.groupType) === 'project'
}

export function partitionGroupsByType<T extends { groupType?: unknown }>(groups: T[]) {
  return groups.reduce(
    (result, group) => {
      if (isProjectGroup(group)) result.projects.push(group)
      else result.conversations.push(group)
      return result
    },
    {
      conversations: [] as T[],
      projects: [] as T[],
    }
  )
}
