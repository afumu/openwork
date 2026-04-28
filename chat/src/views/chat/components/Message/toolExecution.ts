export interface ToolExecutionItem {
  tool_call_id: string
  tool_name: string
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  kind?: 'tool' | 'workflow_step'
  step?: string
  step_title?: string
  display_title?: string
  display_subtitle?: string
  target?: string
  progress?: number
  args_complete?: boolean
  args_preview?: string
  input?: unknown
  is_error?: boolean
  result?: unknown
  result_preview?: string
}

export type ToolExecutionStatus = 'pending' | 'complete' | 'error'

export interface ToolExecutionDisplayModel {
  input: unknown
  result: unknown
  status: ToolExecutionStatus
  summary: string
  toolName: string
}

export interface ToolValueField {
  key: string
  label: string
  value: string
  multiline: boolean
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  Agent: 'Task',
  apply_patch: 'Edit',
  bash: 'Bash',
  exec_command: 'Bash',
  glob: 'Glob',
  grep: 'Grep',
  imageView: 'ViewImage',
  read: 'Read',
  search_query: 'WebSearch',
  shell_command: 'Bash',
  todowrite: 'TodoWrite',
  update_plan: 'UpdatePlan',
  view_image: 'ViewImage',
  web_search_call: 'WebSearch',
  write: 'Write',
  write_stdin: 'WriteStdin',
}

export function normalizeToolName(toolName?: string) {
  const rawName = String(toolName || 'tool').trim() || 'tool'
  return TOOL_NAME_ALIASES[rawName] ?? TOOL_NAME_ALIASES[rawName.toLowerCase()] ?? rawName
}

export function parseToolExecutionValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!/^[\[{"]/.test(trimmed) && !/^(true|false|null|-?\d)/.test(trimmed)) {
    return value
  }
  try {
    return JSON.parse(trimmed)
  } catch (_error) {
    return value
  }
}

export function stringifyToolValue(value: unknown, maxLength?: number) {
  if (value === undefined || value === null || value === '') return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

export function getToolExecutionStatus(item: ToolExecutionItem): ToolExecutionStatus {
  if (item.is_error) return 'error'
  if (item.phase === 'completed' || item.event === 'end') return 'complete'
  return 'pending'
}

export function getToolInput(item: ToolExecutionItem) {
  if (item.input !== undefined) return item.input
  return parseToolExecutionValue(item.args_preview)
}

export function getToolResult(item: ToolExecutionItem) {
  if (item.result !== undefined) return item.result
  return parseToolExecutionValue(item.result_preview)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function labelizeKey(key: string) {
  const explicitLabels: Record<string, string> = {
    cmd: 'Command',
    command: 'Command',
    content: 'Content',
    description: 'Description',
    file_path: 'Path',
    new_string: 'After',
    old_string: 'Before',
    output: 'Output',
    path: 'Path',
    pattern: 'Pattern',
    prompt: 'Prompt',
    query: 'Query',
    stderr: 'Stderr',
    stdout: 'Stdout',
    url: 'URL',
  }

  if (explicitLabels[key]) return explicitLabels[key]
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function stringifyFieldValue(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function sortToolFieldKeys(keys: string[]) {
  const priority = [
    'description',
    'prompt',
    'content',
    'command',
    'cmd',
    'query',
    'pattern',
    'file_path',
    'path',
    'url',
    'old_string',
    'new_string',
    'stdout',
    'stderr',
    'output',
  ]

  return [...keys].sort((left, right) => {
    const leftIndex = priority.indexOf(left)
    const rightIndex = priority.indexOf(right)
    const leftRank = leftIndex === -1 ? priority.length : leftIndex
    const rightRank = rightIndex === -1 ? priority.length : rightIndex
    return leftRank - rightRank || left.localeCompare(right)
  })
}

export function extractToolValueFields(value: unknown) {
  const parsed = typeof value === 'string' ? parseToolExecutionValue(value) : value
  if (!isRecord(parsed)) {
    const text = stringifyToolValue(parsed)
    return text
      ? [
          {
            key: 'value',
            label: 'Value',
            value: text,
            multiline: text.includes('\n') || text.length > 120,
          },
        ]
      : []
  }

  return sortToolFieldKeys(Object.keys(parsed))
    .map(key => {
      const fieldValue = stringifyFieldValue(parsed[key])
      if (!fieldValue) return null

      return {
        key,
        label: labelizeKey(key),
        value: fieldValue,
        multiline:
          fieldValue.includes('\n') || fieldValue.length > 120 || typeof parsed[key] === 'object',
      }
    })
    .filter((field): field is ToolValueField => Boolean(field))
}

function decodeJsonStringValue(value: string) {
  let result = ''

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '\\') {
      result += char
      continue
    }

    const next = value[index + 1]
    if (!next) {
      result += char
      continue
    }

    index += 1
    if (next === 'n') result += '\n'
    else if (next === 'r') result += '\r'
    else if (next === 't') result += '\t'
    else if (next === 'b') result += '\b'
    else if (next === 'f') result += '\f'
    else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 1, index + 5))) {
      result += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 5), 16))
      index += 4
    } else {
      result += next
    }
  }

  return result
}

function extractJsonStringProperty(source: string, propertyNames: string[]) {
  for (const propertyName of propertyNames) {
    const propertyPattern = new RegExp(`"${propertyName}"\\s*:\\s*"`)
    const matched = propertyPattern.exec(source)
    if (!matched) continue

    const valueStart = matched.index + matched[0].length
    let valueEnd = valueStart
    let escaped = false

    while (valueEnd < source.length) {
      const char = source[valueEnd]
      if (escaped) {
        escaped = false
        valueEnd += 1
        continue
      }
      if (char === '\\') {
        escaped = true
        valueEnd += 1
        continue
      }
      if (char === '"') break
      valueEnd += 1
    }

    return decodeJsonStringValue(source.slice(valueStart, valueEnd))
  }

  return ''
}

function getFileName(filePath?: unknown) {
  if (typeof filePath !== 'string' || !filePath.trim()) return ''
  const normalized = filePath.trim()
  return normalized.split(/[\\/]/).pop() || normalized
}

function truncate(value: string, maxLength = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function extractCommand(input: unknown) {
  if (!isRecord(input)) return ''
  const value = input.command ?? input.cmd
  return typeof value === 'string' ? value : ''
}

function extractPlan(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.plan)) return []
  return input.plan.filter(
    (item): item is { step: string; status?: string } =>
      isRecord(item) && typeof item.step === 'string'
  )
}

function getPlanSummary(input: unknown) {
  const plan = extractPlan(input)
  if (!plan.length) return ''
  const completed = plan.filter(item => item.status === 'completed').length
  return `${completed}/${plan.length} completed`
}

function getTodoSummary(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.todos)) return ''
  const todos = input.todos
  const completed = todos.filter(item => isRecord(item) && item.status === 'completed').length
  return `${completed}/${todos.length} completed`
}

export function getToolExecutionSummary(toolName: string, input: unknown, result: unknown) {
  const normalized = normalizeToolName(toolName)

  if (normalized === 'Bash') {
    const command = extractCommand(input)
    return command ? truncate(command, 90) : 'Command'
  }

  if (normalized === 'Read' || normalized === 'Write' || normalized === 'Edit') {
    if (isRecord(input)) {
      const fileName = getFileName(input.file_path ?? input.path)
      if (fileName) return fileName
    }
    if (isRecord(result) && isRecord(result.file)) {
      const fileName = getFileName(result.file.filePath ?? result.file.path)
      if (fileName) return fileName
    }
  }

  if (normalized === 'Grep') {
    if (isRecord(input) && typeof input.pattern === 'string')
      return `"${truncate(input.pattern, 60)}"`
  }

  if (normalized === 'Glob') {
    if (isRecord(input) && typeof input.pattern === 'string') return truncate(input.pattern, 70)
  }

  if (normalized === 'UpdatePlan') {
    return getPlanSummary(input) || 'Update plan'
  }

  if (normalized === 'TodoWrite') {
    return getTodoSummary(input) || 'Update todos'
  }

  if (normalized === 'Task') {
    if (isRecord(input) && typeof input.description === 'string')
      return truncate(input.description, 70)
  }

  if (isRecord(input)) {
    const firstString = Object.values(input).find(
      value => typeof value === 'string' && value.trim().length > 0
    )
    if (typeof firstString === 'string') return truncate(firstString, 70)
  }

  return normalized
}

export function getToolExecutionDisplayModel(item: ToolExecutionItem): ToolExecutionDisplayModel {
  if (item.kind === 'workflow_step') {
    return {
      input: getToolInput(item),
      result: getToolResult(item),
      status: getToolExecutionStatus(item),
      summary:
        item.display_title ||
        item.step_title ||
        (item.step ? item.step.replace(/[_-]+/g, ' ') : 'Workflow step'),
      toolName: 'OpenWork',
    }
  }

  const toolName = normalizeToolName(item.tool_name)
  const input = getToolInput(item)
  const result = getToolResult(item)
  return {
    input,
    result,
    status: getToolExecutionStatus(item),
    summary: getToolExecutionSummary(toolName, input, result),
    toolName,
  }
}

export function extractTextResult(result: unknown) {
  if (typeof result === 'string') return result
  if (isRecord(result)) {
    if (typeof result.stdout === 'string' || typeof result.stderr === 'string') {
      return [result.stdout, result.stderr].filter(Boolean).join('\n')
    }
    if (typeof result.content === 'string') return result.content
    if (isRecord(result.file) && typeof result.file.content === 'string') return result.file.content
    if (typeof result.output === 'string') return result.output
  }
  return stringifyToolValue(result)
}

export function extractWriteContent(input: unknown) {
  if (isRecord(input) && typeof input.content === 'string') {
    return input.content
  }

  if (typeof input === 'string') {
    const parsed = parseToolExecutionValue(input)
    if (isRecord(parsed) && typeof parsed.content === 'string') {
      return parsed.content
    }
    return extractJsonStringProperty(input, ['content'])
  }

  return ''
}

export function extractFilePath(input: unknown, result: unknown) {
  if (isRecord(input) && typeof (input.file_path ?? input.path) === 'string') {
    return String(input.file_path ?? input.path)
  }
  if (typeof input === 'string') {
    const parsed = parseToolExecutionValue(input)
    if (isRecord(parsed) && typeof (parsed.file_path ?? parsed.path) === 'string') {
      return String(parsed.file_path ?? parsed.path)
    }
    const path = extractJsonStringProperty(input, ['file_path', 'path'])
    if (path) return path
  }
  if (isRecord(result) && isRecord(result.file)) {
    const value = result.file.filePath ?? result.file.path
    if (typeof value === 'string') return value
  }
  return ''
}

export function extractPlanItems(input: unknown) {
  return extractPlan(input)
}

export function extractTodos(input: unknown, result: unknown) {
  const source = isRecord(result) && Array.isArray(result.newTodos) ? result : input
  if (!isRecord(source) || !Array.isArray(source.todos)) {
    if (isRecord(source) && Array.isArray(source.newTodos)) return source.newTodos
    return []
  }
  return source.todos
}
