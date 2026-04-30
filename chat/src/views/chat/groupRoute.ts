import type { LocationQueryRaw, LocationQueryValueRaw } from 'vue-router'

export const GROUP_ID_QUERY_KEY = 'groupId'

type RouteQuery = Record<string, unknown>

export function parseRouteGroupId(query: RouteQuery): number | null {
  const rawValue = query[GROUP_ID_QUERY_KEY]
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue
  const groupId = Number(value)

  if (!Number.isInteger(groupId) || groupId <= 0) return null
  return groupId
}

export function resolveActiveGroupId<T extends { uuid: number | string }>(
  groups: T[],
  activeGroupId?: number | string | null,
  preferredGroupId?: number | string | null
) {
  const preferred = Number(preferredGroupId)
  if (Number.isInteger(preferred) && groups.some(group => Number(group.uuid) === preferred)) {
    return preferred
  }

  const active = Number(activeGroupId)
  if (Number.isInteger(active) && groups.some(group => Number(group.uuid) === active)) {
    return active
  }

  return Number(groups[0]?.uuid || 0)
}

function isRouteQueryValue(value: unknown): value is LocationQueryValueRaw {
  return ['string', 'number'].includes(typeof value) || value == null
}

export function buildGroupRouteQuery(
  query: RouteQuery,
  groupId?: number | string | null
): LocationQueryRaw {
  const nextQuery: LocationQueryRaw = {}
  const nextGroupId = Number(groupId)

  Object.entries(query).forEach(([key, value]) => {
    if (key === GROUP_ID_QUERY_KEY) return

    if (isRouteQueryValue(value)) {
      nextQuery[key] = value
    } else if (Array.isArray(value)) {
      nextQuery[key] = value.filter(isRouteQueryValue)
    }
  })

  if (Number.isInteger(nextGroupId) && nextGroupId > 0) {
    nextQuery[GROUP_ID_QUERY_KEY] = String(nextGroupId)
  } else {
    delete nextQuery[GROUP_ID_QUERY_KEY]
  }

  return nextQuery
}

export function shouldSyncActiveGroupToRoute(
  activeGroupId: number | string | null | undefined,
  query: RouteQuery
) {
  const active = Number(activeGroupId)
  if (!Number.isInteger(active) || active <= 0) return false

  return parseRouteGroupId(query) !== active
}
