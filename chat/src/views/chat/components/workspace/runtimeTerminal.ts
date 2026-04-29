export type RuntimeTerminalServerMessage =
  | {
      containerName?: string
      cwd?: string
      shell?: string
      type: 'ready'
    }
  | {
      data: string
      type: 'output'
    }
  | {
      message: string
      type: 'error'
    }
  | {
      code?: number
      signal?: number
      type: 'exit'
    }

export function buildRuntimeTerminalWsUrl(input: {
  apiBaseUrl: string
  cols: number
  groupId: number
  rows: number
  token: string
  windowLocation: Location | URL
}) {
  const baseUrl = new URL(input.apiBaseUrl || '/api', input.windowLocation.href)
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = new URL(`${baseUrl.pathname.replace(/\/+$/, '')}/openwork/runtime/terminal`, baseUrl)
  wsUrl.protocol = protocol
  wsUrl.searchParams.set('groupId', String(input.groupId))
  wsUrl.searchParams.set('token', input.token)
  wsUrl.searchParams.set('cols', String(input.cols))
  wsUrl.searchParams.set('rows', String(input.rows))
  return wsUrl.toString()
}

export function parseRuntimeTerminalServerMessage(value: string): RuntimeTerminalServerMessage | null {
  let parsed: any

  try {
    parsed = JSON.parse(value)
  } catch (_error) {
    return null
  }

  if (parsed?.type === 'ready') {
    return {
      containerName: typeof parsed.containerName === 'string' ? parsed.containerName : undefined,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
      shell: typeof parsed.shell === 'string' ? parsed.shell : undefined,
      type: 'ready',
    }
  }

  if (parsed?.type === 'output' && typeof parsed.data === 'string') {
    return {
      data: parsed.data,
      type: 'output',
    }
  }

  if (parsed?.type === 'error') {
    return {
      message: typeof parsed.message === 'string' ? parsed.message : '终端连接失败',
      type: 'error',
    }
  }

  if (parsed?.type === 'exit') {
    return {
      code: typeof parsed.code === 'number' ? parsed.code : undefined,
      signal: typeof parsed.signal === 'number' ? parsed.signal : undefined,
      type: 'exit',
    }
  }

  return null
}
