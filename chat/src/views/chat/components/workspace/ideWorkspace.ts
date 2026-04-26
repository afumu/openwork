import type { ArtifactWorkspaceTreeItem } from './types'

export interface IdeTreeNode {
  children?: IdeTreeNode[]
  data: {
    nodeType: 'directory' | 'file'
    path: string
    runId?: string | null
    type?: string
  }
  id: string
  label: string
}

export interface IdeTabFile {
  path: string
}

export interface ToolExecutionLike {
  args_preview?: string
  display_title?: string
  phase?: string
  result_preview?: string
  step_title?: string
  target?: string
  tool_name?: string
}

export type CodeLanguage =
  | 'css'
  | 'html'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'sql'
  | 'text'
  | 'typescript'
  | 'vue'
  | 'xml'
  | 'yaml'

export function buildIdeTreeNodes(nodes: ArtifactWorkspaceTreeItem[]): IdeTreeNode[] {
  return nodes.map(node => {
    if (node.nodeType === 'directory') {
      return {
        children: buildIdeTreeNodes(node.children),
        data: {
          nodeType: 'directory',
          path: node.path,
        },
        id: `directory:${node.path}`,
        label: node.name,
      }
    }

    return {
      data: {
        nodeType: 'file',
        path: node.path,
        runId: node.runId,
        type: node.type,
      },
      id: `file:${node.path}`,
      label: node.name,
    }
  })
}

export function resolveCodeLanguage(path: string, mimeType = ''): CodeLanguage {
  const ext = getExtension(path)
  if (mimeType.includes('typescript') || ['ts', 'tsx'].includes(ext)) return 'typescript'
  if (mimeType.includes('javascript') || ['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return 'javascript'
  }
  if (mimeType.includes('html') || ['html', 'htm'].includes(ext)) return 'html'
  if (mimeType.includes('json') || ext === 'json') return 'json'
  if (mimeType.includes('markdown') || ['md', 'markdown'].includes(ext)) return 'markdown'
  if (mimeType.includes('python') || ext === 'py') return 'python'
  if (ext === 'vue') return 'vue'
  if (['css', 'scss', 'less'].includes(ext)) return 'css'
  if (['yaml', 'yml'].includes(ext)) return 'yaml'
  if (ext === 'xml') return 'xml'
  if (ext === 'rs') return 'rust'
  if (ext === 'sql') return 'sql'
  return 'text'
}

export function resolveIdeTabTitle(file: IdeTabFile | null) {
  if (!file?.path) return '代码编辑器'
  return file.path.split('/').pop() || file.path
}

export function toTerminalLines(records: ToolExecutionLike[]) {
  return records.map(record => {
    const name = record.display_title || record.step_title || record.tool_name || 'tool'
    const phase = record.phase || 'event'
    const detail = record.args_preview || record.target || record.result_preview || ''
    return ['$ ', name, ' ', phase, detail ? ` ${detail}` : ''].join('')
  })
}

function getExtension(path: string) {
  const fileName = path.split('?')[0]?.split('/').pop() || path
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}
