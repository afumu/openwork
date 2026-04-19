export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getInitials(name: string) {
  if (!name) return 'AI'
  if (name.length <= 2) return name
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase()
}

export function getAvatarStyle(seed: string) {
  const palette = [
    'linear-gradient(135deg, #2563eb, #7c3aed)',
    'linear-gradient(135deg, #0f766e, #14b8a6)',
    'linear-gradient(135deg, #ea580c, #f59e0b)',
    'linear-gradient(135deg, #be123c, #f43f5e)',
    'linear-gradient(135deg, #4f46e5, #06b6d4)',
    'linear-gradient(135deg, #1d4ed8, #60a5fa)',
  ]

  const hash = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return {
    backgroundImage: palette[hash % palette.length],
  }
}

export function formatTimeLabel(dateTime: string) {
  const date = new Date(dateTime)
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${hour}:${minute}`
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
