export interface StreamJsonParseResult<T> {
  items: T[]
  buffer: string
}

export function parseStreamJsonLines<T>(
  chunk: string,
  previousBuffer = ''
): StreamJsonParseResult<T> {
  const source = `${previousBuffer}${chunk}`.replace(/\r\n/g, '\n')
  const lines = source.split('\n')
  const buffer = lines.pop() ?? ''
  const items: T[] = []

  lines.forEach(line => {
    const trimmed = line.trim()
    if (!trimmed) return
    items.push(JSON.parse(trimmed) as T)
  })

  return {
    items,
    buffer,
  }
}

export function flushStreamJsonBuffer<T>(buffer: string): T[] {
  const trimmed = buffer.trim()
  if (!trimmed) return []
  return [JSON.parse(trimmed) as T]
}
