<script lang="ts" setup>
import { fetchTtsAPIProcess } from '@/api'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'
import { useAppStore, useAuthStore, useGlobalStoreWithOut } from '@/store'
import { selectVisibleArtifactSummaryFiles } from '@/utils/artifactSummary'
import { copyText } from '@/utils/format'
import { message } from '@/utils/message'
import {
  ArrowRight,
  CheckOne,
  Close,
  Copy,
  Delete,
  DocDetail,
  Down,
  Edit,
  FileCode,
  LoadingOne,
  PauseOne,
  Refresh,
  Rotation,
  Send,
  Sound,
  Sphere,
  TwoEllipses,
  Up,
  VoiceMessage,
} from '@icon-park/vue-next'
import mdKatex from '@traptitech/markdown-it-katex'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css' // 更现代的深色主题
import 'highlight.js/styles/atom-one-light.css' // 更现代的浅色主题
import MarkdownIt from 'markdown-it'
import mila from 'markdown-it-link-attributes'
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

// 注册mermaid语言到highlight.js
hljs.registerLanguage('mermaid', () => ({
  name: 'mermaid',
  contains: [],
  keywords: {
    keyword: 'graph flowchart sequenceDiagram classDiagram stateDiagram gitGraph pie gantt',
    built_in: 'TD TB BT RL LR',
  },
  case_insensitive: true,
}))

// 注册样式覆盖，确保主题切换时正确应用对应样式
const injectThemeStyles = () => {
  // 检查是否已存在样式元素
  const existingStyle = document.getElementById('highlight-theme-overrides')
  if (existingStyle) return

  // 创建新的样式元素
  const style = document.createElement('style')
  style.id = 'highlight-theme-overrides'
  style.textContent = `
    /* 浅色模式覆盖 */
    html:not(.dark) .hljs {
      background: transparent !important;
      color: #383a42 !important;
    }
    
    /* 深色模式覆盖 */
    html.dark .hljs {
      background: transparent !important;
      color: #abb2bf !important;
    }
    
    /* 容器背景 */
    html:not(.dark) .code-block-wrapper {
      background-color: #fafafa;
    }
    
    html.dark .code-block-wrapper {
      background-color: #2f2f2f;
    }
  `
  document.head.appendChild(style)
}

interface Props {
  chatId?: number
  index: number
  isUserMessage?: boolean
  content?: string
  modelType?: number
  status?: number
  loading?: boolean
  imageUrl?: string
  fileUrl?: string
  ttsUrl?: string
  model?: string
  promptReference?: string
  networkSearchResult?: string
  fileVectorResult?: string
  tool_calls?: string
  toolExecution?: string
  artifactFiles?: string
  streamSegments?: string
  isLast?: boolean
  usingNetwork?: boolean
  usingDeepThinking?: boolean
  usingMcpTool?: boolean
  reasoningText?: string
  fileAnalysisProgress?: number
  useFileSearch?: boolean
}

interface Emit {
  (ev: 'regenerate'): void
  (ev: 'delete'): void
  (ev: 'copy'): void
}

interface ToolExecutionItem {
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
  is_error?: boolean
  result_preview?: string
}

interface TextAssistantStreamSegment {
  id: string
  type: 'text'
  text: string
}

interface ToolExecutionAssistantStreamSegment extends ToolExecutionItem {
  id: string
  type: 'tool_execution'
}

type AssistantStreamSegment = TextAssistantStreamSegment | ToolExecutionAssistantStreamSegment

interface TtsResponse {
  ttsUrl: string
}

interface ArtifactFileSummary {
  name: string
  path: string
  preview?: string
  size: number
  type: string
  updatedAt: string
  runId: string | null
}

const authStore = useAuthStore()
const appStore = useAppStore()
const { isMobile } = useBasicLayout()
const onConversation = inject<any>('onConversation')
const handleRegenerate = inject<any>('handleRegenerate')
const openArtifactPreview = inject<(path?: string) => void>(
  'openArtifactPreview',
  (_path?: string) => {}
)
const globalStore = useGlobalStoreWithOut()

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const showThinking = ref(true)
const showSearchResult = ref(false)
const showToolExecution = ref(true)
const textRef = ref<HTMLElement>()
const localTtsUrl = ref(props.ttsUrl)
const playbackState = ref('paused')
const browserTtsState = ref('paused')
const editableContent = ref(props.content)
const isEditable = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)
const themeSignal = ref(0)

let currentAudio: HTMLAudioElement | null = null
let speechSynthesisUtterance: SpeechSynthesisUtterance | null = null
let themeObserver: MutationObserver | null = null

const onOpenImagePreviewer =
  inject<(imageUrls: string[], initialIndex: number, extraData?: any) => void>(
    'onOpenImagePreviewer'
  )

const isHideTts = computed(() => Number(authStore.globalConfig?.isHideTts) === 1)
const enableHtmlRender = computed(() => Number(authStore.globalConfig?.enableHtmlRender) !== 0)

function getDocumentDarkTheme() {
  if (typeof document === 'undefined') return false
  const html = document.documentElement
  return html.classList.contains('dark') || html.dataset.theme === 'dark'
}

function syncThemeSignal() {
  themeSignal.value += 1
}

const isDarkTheme = computed(() => {
  themeSignal.value
  if (appStore.theme === 'dark') return true
  if (typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'dark') return true
  if (typeof window !== 'undefined' && window.theme === 'dark') return true
  return getDocumentDarkTheme()
})

const artifactSummaryThemeVars = computed<Record<string, string>>(() => {
  if (isDarkTheme.value) {
    return {
      '--artifact-summary-card-bg': 'rgba(24, 24, 27, 0.94)',
      '--artifact-summary-card-hover': 'rgba(39, 39, 42, 0.96)',
      '--artifact-summary-border': 'rgba(255, 255, 255, 0.11)',
      '--artifact-summary-border-hover': 'rgba(96, 165, 250, 0.34)',
      '--artifact-summary-text': '#f8fafc',
      '--artifact-summary-muted': 'rgba(226, 232, 240, 0.62)',
      '--artifact-summary-soft': 'rgba(255, 255, 255, 0.07)',
      '--artifact-summary-shadow': '0 18px 52px rgba(0, 0, 0, 0.34)',
      '--artifact-summary-gradient-start': 'rgba(24, 24, 27, 0)',
      '--artifact-summary-gradient-mid': 'rgba(24, 24, 27, 0.72)',
      '--artifact-summary-gradient-end': '#18181b',
      '--artifact-summary-code-bg': 'rgba(255, 255, 255, 0.09)',
    }
  }

  return {
    '--artifact-summary-card-bg': 'rgba(255, 255, 255, 0.92)',
    '--artifact-summary-card-hover': 'rgba(248, 250, 252, 0.98)',
    '--artifact-summary-border': 'rgba(15, 23, 42, 0.1)',
    '--artifact-summary-border-hover': 'rgba(37, 99, 235, 0.28)',
    '--artifact-summary-text': '#111827',
    '--artifact-summary-muted': 'rgba(51, 65, 85, 0.66)',
    '--artifact-summary-soft': 'rgba(15, 23, 42, 0.045)',
    '--artifact-summary-shadow': '0 18px 48px rgba(15, 23, 42, 0.08)',
    '--artifact-summary-gradient-start': 'rgba(255, 255, 255, 0)',
    '--artifact-summary-gradient-mid': 'rgba(255, 255, 255, 0.72)',
    '--artifact-summary-gradient-end': '#ffffff',
    '--artifact-summary-code-bg': 'rgba(15, 23, 42, 0.06)',
  }
})

watch(() => appStore.theme, syncThemeSignal)

function startThemeObserver() {
  if (typeof document === 'undefined') return false
  if (themeObserver) return true

  themeObserver = new MutationObserver(syncThemeSignal)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  })
  syncThemeSignal()
  return true
}

const searchResult = computed(() => {
  if (props.networkSearchResult) {
    try {
      const parsedData = JSON.parse(props.networkSearchResult)
      return parsedData?.slice(0, 50) || parsedData?.searchResults?.slice(0, 50) || []
    } catch (e) {
      console.error('解析 networkSearchResult 时出错', e)
      return []
    }
  }
  return []
})

const buttonGroupClass = computed(() => {
  return playbackState.value !== 'paused' || isEditable.value
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100'
})

const handlePlay = async () => {
  if (playbackState.value === 'loading' || playbackState.value === 'playing') return
  if (localTtsUrl.value) {
    playAudio(localTtsUrl.value)
    return
  }

  playbackState.value = 'loading'
  try {
    if (!props.chatId || !props.content) return

    const res = (await fetchTtsAPIProcess({
      chatId: props.chatId,
      prompt: props.content,
    })) as TtsResponse

    const ttsUrl = res.ttsUrl
    if (ttsUrl) {
      localTtsUrl.value = ttsUrl
      playAudio(ttsUrl)
    } else {
      throw new Error('TTS URL is undefined')
    }
  } catch (error) {
    playbackState.value = 'paused'
  }
}

function playAudio(audioSrc: string | undefined) {
  if (currentAudio) {
    currentAudio.pause()
  }
  currentAudio = new Audio(audioSrc)
  currentAudio
    .play()
    .then(() => {
      playbackState.value = 'playing'
    })
    .catch(error => {
      playbackState.value = 'paused'
    })

  currentAudio.onended = () => {
    playbackState.value = 'paused'
    currentAudio = null
  }
}

function pauseAudio() {
  if (currentAudio) {
    currentAudio.pause()
    playbackState.value = 'paused'
  }
}

function playOrPause() {
  if (playbackState.value === 'playing') {
    pauseAudio()
  } else {
    handlePlay()
  }
}

function handleBrowserTts() {
  if (browserTtsState.value === 'playing') {
    stopBrowserTts()
  } else {
    playBrowserTts()
  }
}

function playBrowserTts() {
  if (!('speechSynthesis' in window)) {
    console.error('浏览器不支持语音合成API')
    return
  }

  stopBrowserTts()

  speechSynthesisUtterance = new SpeechSynthesisUtterance(props.content)

  speechSynthesisUtterance.lang = 'zh-CN'
  speechSynthesisUtterance.rate = 1.0
  speechSynthesisUtterance.pitch = 1.0

  speechSynthesisUtterance.onstart = () => {
    browserTtsState.value = 'playing'
  }

  speechSynthesisUtterance.onend = () => {
    browserTtsState.value = 'paused'
    speechSynthesisUtterance = null
  }

  speechSynthesisUtterance.onerror = () => {
    browserTtsState.value = 'paused'
    speechSynthesisUtterance = null
  }

  window.speechSynthesis.speak(speechSynthesisUtterance)
}

function stopBrowserTts() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel()
    browserTtsState.value = 'paused'
    speechSynthesisUtterance = null
  }
}

const mdi = new MarkdownIt({
  linkify: true,
  html: enableHtmlRender.value,
  highlight(code, language) {
    const validLang = !!(language && hljs.getLanguage(language))
    if (validLang) {
      const lang = language ?? ''
      return highlightBlock(hljs.highlight(code, { language: lang }).value, lang)
    }

    return highlightBlock(hljs.highlightAuto(code).value, '')
  },
})

// 用于存储代码块复制按钮的定时器
const copyTimeoutsMap = new Map()

// 复制代码的处理函数
function handleCodeCopy(blockId: string, element: HTMLElement) {
  console.log('复制开始，blockId:', blockId)
  // 如果已经是"已复制"状态，则不重复处理
  const copiedText = element.querySelector('.copied-text')
  if (copiedText && getComputedStyle(copiedText).display !== 'none') return

  const codeBlock = document.getElementById(blockId)
  if (!codeBlock) {
    console.error('未找到代码块:', blockId)
    return
  }

  const codeElement = codeBlock.querySelector('code')
  if (!codeElement || !codeElement.textContent) {
    console.error('未找到代码内容')
    return
  }

  // 复制代码内容
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(codeElement.textContent)
        .then(() => {
          console.log('使用navigator.clipboard成功复制')
          // 成功复制后更新UI
          updateCopyButtonState(element, blockId)
        })
        .catch(err => {
          console.error('navigator.clipboard复制失败:', err)
          // 尝试回退方法
          fallbackCopy(codeElement.textContent, element, blockId)
        })
    } else {
      // 回退到传统方法
      fallbackCopy(codeElement.textContent, element, blockId)
    }
  } catch (error) {
    console.error('复制过程出错:', error)
    message()?.error('复制失败!')
  }
}

// 回退复制方法
function fallbackCopy(text: string | null, element: HTMLElement, blockId: string) {
  if (!text) {
    console.error('复制内容为空')
    message()?.error('复制失败!')
    return
  }

  try {
    copyText({ text: text, origin: true })
    console.log('使用fallback方法复制成功')
    updateCopyButtonState(element, blockId)
  } catch (error) {
    console.error('fallback复制失败:', error)
    message()?.error('复制失败!')
  }
}

// 更新复制按钮状态
function updateCopyButtonState(element: HTMLElement, blockId: string) {
  // 防止重复处理
  if (element.getAttribute('data-copying') === 'true') return
  element.setAttribute('data-copying', 'true')

  // 查找按钮中的图标和文本元素
  const copyIcon = element.querySelector('.copy-icon')
  const checkIcon = element.querySelector('.check-icon')
  const copyText = element.querySelector('.copy-text')
  const copiedText = element.querySelector('.copied-text')

  if (copyIcon && checkIcon && copyText && copiedText) {
    // 隐藏复制图标和文本，显示勾图标和已复制文本
    copyIcon.classList.add('hidden')
    copyText.classList.add('hidden')
    checkIcon.classList.remove('hidden')
    copiedText.classList.remove('hidden')
  }

  // 成功提示
  message()?.success('复制成功!')

  // 清除之前的定时器
  if (copyTimeoutsMap.has(blockId)) {
    clearTimeout(copyTimeoutsMap.get(blockId))
  }

  // 设置新的定时器，3秒后恢复原始状态
  const timeoutId = setTimeout(() => {
    console.log('恢复原始按钮内容')
    if (element) {
      const copyIcon = element.querySelector('.copy-icon')
      const checkIcon = element.querySelector('.check-icon')
      const copyText = element.querySelector('.copy-text')
      const copiedText = element.querySelector('.copied-text')

      if (copyIcon && checkIcon && copyText && copiedText) {
        // 恢复原状
        copyIcon.classList.remove('hidden')
        copyText.classList.remove('hidden')
        checkIcon.classList.add('hidden')
        copiedText.classList.add('hidden')
      }

      // 清除处理标记
      element.removeAttribute('data-copying')
    }
  }, 3000)

  // 存储定时器ID以便后续清理
  copyTimeoutsMap.set(blockId, timeoutId)
}

mdi.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const src = token.attrGet('src')
  const title = token.attrGet('title')
  const alt = token.content

  if (!src) return ''

  return `<img src="${src}" alt="${alt || ''}" title="${title || alt || ''}" class="rounded-md max-h-[30vh] cursor-pointer hover:opacity-90 transition-opacity" 
    onclick="(function(event) { 
      event.stopPropagation();
      const customEvent = new CustomEvent('previewMdImage', { detail: { src: '${src}' } });
      document.dispatchEvent(customEvent);
    })(event)"
  />`
}

const imageUrlArray = computed(() => {
  const val = props.imageUrl
  if (!val) return []
  // 支持 JSON 字符串格式 {"imageUrls":[...]}
  if (typeof val === 'string' && val.trim().startsWith('{') && val.includes('imageUrls')) {
    try {
      const parsed = JSON.parse(val)
      if (parsed && Array.isArray(parsed.imageUrls)) {
        return parsed.imageUrls.map((item: any) => item.url).filter(Boolean)
      }
    } catch (e) {}
  }
  // 新增：支持 JSON 数组字符串格式
  if (typeof val === 'string' && val.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(val)
      if (Array.isArray(arr)) {
        return arr.map((item: any) => item.url).filter(Boolean)
      }
    } catch (e) {}
  }
  if (typeof val === 'string') {
    // 兼容逗号分隔
    return val
      .split(',')
      .map(url => url.trim())
      .filter(Boolean)
  }
  if (Array.isArray(val)) return val
  return []
})

const isImageUrl = computed(() => {
  if (!props.imageUrl) return false

  // 如果已经成功提取了URLs，则认为是图片
  if (imageUrlArray.value.length > 0) {
    return true
  }

  // 如果没有提取出来，检查原始值
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(props.imageUrl)
})

mdi.use(mila, { attrs: { target: '_blank', rel: 'noopener' } })
mdi.use(mdKatex, {
  blockClass: 'katexmath-block p-0 flex h-full items-center justify-start',
  inlineClass: 'katexmath-inline',
  errorColor: ' #cc0000',
})

function normalizeMarkdownSource(value: string) {
  return value
    .replace(/\\\(\s*/g, '$')
    .replace(/\s*\\\)/g, '$')
    .replace(/\\\[\s*/g, '$$')
    .replace(/\s*\\\]/g, '$$')
    .replace(
      /\[\[(\d+)\]\((https?:\/\/[^\)]+)\)\]/g,
      '<button class="bg-gray-500 text-white rounded-full w-4 h-4 mx-1 flex justify-center items-center text-sm hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500 inline-flex" onclick="window.open(\'$2\', \'_blank\')">$1</button>'
    )
}

function renderMessageContent(value: string, isUserMessage: boolean) {
  const modifiedValue = normalizeMarkdownSource(value)
  return isUserMessage ? modifiedValue : mdi.render(modifiedValue)
}

function renderAssistantMarkdown(value: string) {
  return renderMessageContent(value || '', false)
}

const text = computed(() => renderMessageContent(props.content || '', Boolean(props.isUserMessage)))

const reasoningText = computed<string>(() =>
  renderMessageContent(props.reasoningText || '', Boolean(props.isUserMessage))
)

const parsedToolExecution = computed<ToolExecutionItem[]>(() => {
  if (!props.toolExecution) return []
  try {
    const parsed = JSON.parse(props.toolExecution)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    return []
  }
})

const parsedStreamSegments = computed<AssistantStreamSegment[]>(() => {
  if (!props.streamSegments) return []

  try {
    const parsed = JSON.parse(props.streamSegments)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(item => {
      if (!item || typeof item !== 'object') return false
      if (item.type === 'text') return typeof item.text === 'string'
      return item.type === 'tool_execution'
    }) as AssistantStreamSegment[]
  } catch (error) {
    return []
  }
})

const hasOrderedStreamSegments = computed(() => parsedStreamSegments.value.length > 0)

function artifactTypeLabel(file?: ArtifactFileSummary | null) {
  if (!file) return '文件'
  if (file.type === 'html') return '代码'
  if (file.type === 'markdown') return '文档'
  if (file.type === 'image') return '图片'
  if (file.type === 'json' || file.type === 'text') return '文件'
  return '文件'
}

function formatArtifactSize(size?: number) {
  if (!size && size !== 0) return '--'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function getArtifactExtension(path?: string) {
  if (!path) return ''
  const fileName = path.split('?')[0]?.split('/').pop() || path
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}

function isMarkdownArtifact(file?: ArtifactFileSummary | null) {
  if (!file) return false
  const ext = getArtifactExtension(file.path)
  return file.type === 'markdown' || ext === 'md' || ext === 'markdown'
}

function parseArtifactFiles(value?: string): ArtifactFileSummary[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && typeof item === 'object' && item.path && item.name)
  } catch (_error) {
    return []
  }
}

const allArtifactFiles = computed(() => parseArtifactFiles(props.artifactFiles))
const artifactFiles = computed(() => selectVisibleArtifactSummaryFiles(allArtifactFiles.value))
const hiddenArtifactCount = computed(() =>
  Math.max(0, allArtifactFiles.value.length - artifactFiles.value.length)
)
const markdownArtifactFiles = computed(() =>
  artifactFiles.value.filter(file => isMarkdownArtifact(file) && file.preview?.trim())
)
const compactArtifactFiles = computed(() =>
  artifactFiles.value.filter(file => !markdownArtifactFiles.value.includes(file))
)
const shouldShowArtifactSummary = computed(() => {
  return Boolean(!props.isUserMessage && !props.loading && artifactFiles.value.length)
})

function normalizeArtifactMarkdownPreview(file?: ArtifactFileSummary | null) {
  let value = file?.preview?.trim() || ''
  if (!value) return ''

  // The card header already shows the file name, so avoid repeating a top-level title.
  value = value.replace(/^\s*#\s+[^\n]{1,80}\n+/, '')

  // Some generated files accidentally put a whole paragraph on the first H1 line.
  // In a compact card this becomes visually overwhelming, so render it as normal text.
  value = value.replace(/^\s*#{1,2}\s+([^\n]{80,})/, '$1')

  return value.slice(0, 1800)
}

function renderArtifactMarkdownPreview(file?: ArtifactFileSummary | null) {
  return renderAssistantMarkdown(normalizeArtifactMarkdownPreview(file))
}

const toolNameMap: Record<string, string> = {
  bash: '执行命令',
  edit: '编辑文件',
  fetch: '抓取页面',
  find: '查找内容',
  glob: '查找文件',
  grep: '搜索文本',
  list_dir: '查看目录',
  ls: '查看目录',
  multi_tool_use: '并行处理',
  open: '打开页面',
  read: '读取文件',
  replace: '替换内容',
  search: '联网搜索',
  web_search: '联网搜索',
  write: '写入文件',
}

const toolExecutionSummary = computed(() => {
  if (!parsedToolExecution.value.length) return ''
  const workflowCount = parsedToolExecution.value.filter(
    item => item.kind === 'workflow_step'
  ).length
  if (workflowCount > 0) return `执行流程 (${workflowCount})`
  const activeCount = parsedToolExecution.value.filter(item => {
    if (item.phase === 'completed') return false
    return item.event !== 'end'
  }).length
  if (activeCount > 0) return `工具执行中 (${activeCount})`
  return `工具执行 (${parsedToolExecution.value.length})`
})

function getLocalizedToolName(toolName?: string) {
  if (!toolName) return '工具调用'
  return toolNameMap[toolName] || toolName.replace(/[_-]/g, ' ')
}

function truncateDisplayText(value?: string, maxLength = 56) {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function extractJsonStringValue(text: string | undefined, keys: string[]) {
  if (!text) return ''

  for (const key of keys) {
    const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i')
    const matched = text.match(regex)
    if (matched?.[1]) {
      return matched[1]
    }
  }

  return ''
}

function extractPathCandidate(...values: Array<string | undefined>) {
  const fileNameRegex =
    /(?:^|[\s"'`])([A-Za-z0-9._/-]+\.(?:md|markdown|txt|html|js|jsx|ts|tsx|json|py|sh|yaml|yml|css|scss|less|vue|xml|csv|pdf|png|jpg|jpeg|webp|gif))/i

  for (const value of values) {
    if (!value) continue

    const jsonPath =
      extractJsonStringValue(value, [
        'path',
        'file_path',
        'filePath',
        'filename',
        'output',
        'target',
      ]) || ''
    if (jsonPath) return jsonPath

    const pathMatch = value.match(/(?:\/|\.\/|\.\.\/)[^\s"'`,)]+/g)
    if (pathMatch?.length) {
      const matchedPath = pathMatch.find(item => /\.[A-Za-z0-9]+$/.test(item)) || pathMatch[0]
      if (matchedPath) return matchedPath
    }

    const fileNameMatch = value.match(fileNameRegex)
    if (fileNameMatch?.[1]) {
      return fileNameMatch[1]
    }
  }

  return ''
}

function extractUrlCandidate(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue

    const jsonUrl = extractJsonStringValue(value, ['url', 'link', 'href'])
    if (jsonUrl) return jsonUrl

    const urlMatch = value.match(/https?:\/\/[^\s"'`,)]+/i)
    if (urlMatch?.[0]) return urlMatch[0]
  }

  return ''
}

function extractCommandCandidate(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue

    const jsonCommand = extractJsonStringValue(value, ['command', 'cmd'])
    if (jsonCommand) return jsonCommand

    const commandMatch = value.match(
      /(?:^|[\s"'`])((?:pnpm|npm|yarn|bun|node|python|python3|pytest|git|rg|grep|find|ls|cat|sed|bash|sh)\b[^\n]*)/i
    )
    if (commandMatch?.[1]) {
      return commandMatch[1].trim()
    }
  }

  return ''
}

function extractSearchQuery(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue

    const jsonQuery =
      extractJsonStringValue(value, ['query', 'q', 'pattern', 'keyword', 'keywords', 'search']) ||
      ''
    if (jsonQuery) return jsonQuery

    const quotedMatch = value.match(/"([^"]{2,80})"/)
    if (quotedMatch?.[1]) {
      return quotedMatch[1]
    }
  }

  return ''
}

function formatToolPathLabel(path?: string) {
  if (!path) return ''
  const cleaned = path.split('?')[0].replace(/[)"'`,]+$/, '')
  const segments = cleaned.split('/').filter(Boolean)
  if (!segments.length) return cleaned
  return segments[segments.length - 1] || cleaned
}

function formatToolFriendlyLabel(value?: string) {
  if (!value) return ''
  const fileName = formatToolPathLabel(value)
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  return truncateDisplayText(withoutExtension.replace(/[_-]+/g, ' ').trim(), 26)
}

function formatHostLabel(url?: string) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (_error) {
    return truncateDisplayText(url, 32)
  }
}

function getToolActionPrefix(item: {
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  is_error?: boolean
}) {
  if (item.is_error) return '未能'
  if (item.phase === 'assembling') return '正在准备'
  if (isToolExecutionActive(item)) return '正在'
  return '已'
}

function buildToolActionText(
  item: {
    event: 'start' | 'update' | 'end'
    phase?: 'assembling' | 'executing' | 'completed'
    is_error?: boolean
  },
  action: string
) {
  return `${getToolActionPrefix(item)}${action}`
}

function summarizeCommandAction(command?: string) {
  const normalized = command?.replace(/\s+/g, ' ').trim() || ''
  if (!normalized) {
    return {
      action: '执行命令',
      subtitle: '调用命令行工具推进当前任务',
      target: '',
    }
  }

  if (/\b(pnpm|npm|yarn|bun)\b.*\b(test|vitest|jest)\b|\bpytest\b/i.test(normalized)) {
    return {
      action: '运行测试',
      subtitle: '验证当前修改是否正常工作',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(pnpm|npm|yarn|bun)\b.*\b(build|vite build)\b/i.test(normalized)) {
    return {
      action: '构建项目',
      subtitle: '检查前端产物是否可以顺利打包',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(pnpm|npm|yarn|bun)\b.*\b(lint|eslint|prettier)\b/i.test(normalized)) {
    return {
      action: '检查代码风格',
      subtitle: '统一格式并发现潜在语法问题',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(pnpm|npm|yarn|bun)\b.*\b(install|add)\b/i.test(normalized)) {
    return {
      action: '安装依赖',
      subtitle: '补齐当前任务所需的运行环境',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\bgit\s+(status|diff|log|show)\b/i.test(normalized)) {
    return {
      action: '检查仓库状态',
      subtitle: '确认当前代码改动与上下文信息',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\bgit\s+(add|commit)\b/i.test(normalized)) {
    return {
      action: '提交代码',
      subtitle: '整理本轮修改并写入 Git 历史',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(rg|grep)\b/i.test(normalized)) {
    return {
      action: '搜索代码内容',
      subtitle: '定位项目里的关键实现位置',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(ls|find)\b/i.test(normalized)) {
    return {
      action: '查看项目结构',
      subtitle: '检查目录和文件分布情况',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(cat|sed)\b/i.test(normalized)) {
    return {
      action: '读取文件内容',
      subtitle: '查看现有实现细节后再继续处理',
      target: truncateDisplayText(normalized, 34),
    }
  }

  if (/\b(node|python|python3|bash|sh)\b/i.test(normalized)) {
    return {
      action: '运行脚本',
      subtitle: '执行辅助脚本完成当前步骤',
      target: truncateDisplayText(normalized, 34),
    }
  }

  return {
    action: '执行命令',
    subtitle: '通过命令行推进当前任务',
    target: truncateDisplayText(normalized, 34),
  }
}

function getToolExecutionDisplay(item: ToolExecutionItem) {
  if (item.kind === 'workflow_step' || item.tool_name === 'openwork_step') {
    return {
      title:
        item.display_title ||
        item.step_title ||
        (item.step ? item.step.replace(/[_-]+/g, ' ') : '流程步骤'),
      subtitle:
        item.display_subtitle ||
        (typeof item.progress === 'number'
          ? `当前进度 ${Math.max(0, Math.min(100, item.progress))}%`
          : 'OpenWork 正在执行当前步骤'),
      target: item.target ? formatToolPathLabel(item.target) : '',
    }
  }

  const path = extractPathCandidate(item.args_preview, item.result_preview)
  const fileLabel = formatToolPathLabel(path)
  const friendlyFileLabel = formatToolFriendlyLabel(path)
  const command = extractCommandCandidate(item.args_preview, item.result_preview)
  const query = extractSearchQuery(item.args_preview, item.result_preview)
  const url = extractUrlCandidate(item.args_preview, item.result_preview)

  switch (item.tool_name) {
    case 'read':
      return {
        title: buildToolActionText(item, '读取参考文件'),
        subtitle: friendlyFileLabel
          ? `提取 ${friendlyFileLabel} 的上下文内容`
          : '读取项目里的说明、配置或已有产物',
        target: fileLabel,
      }
    case 'write':
      return {
        title: buildToolActionText(item, '写入输出文件'),
        subtitle: friendlyFileLabel
          ? `生成并保存 ${friendlyFileLabel}`
          : '将本轮结果落盘为可交付文件',
        target: fileLabel,
      }
    case 'edit':
    case 'replace':
      return {
        title: buildToolActionText(item, '修改文件内容'),
        subtitle: friendlyFileLabel
          ? `更新 ${friendlyFileLabel} 的实现细节`
          : '对现有文件进行定向调整',
        target: fileLabel,
      }
    case 'bash': {
      const commandSummary = summarizeCommandAction(command)
      return {
        title: buildToolActionText(item, commandSummary.action),
        subtitle: commandSummary.subtitle,
        target: commandSummary.target,
      }
    }
    case 'search':
    case 'web_search':
      return {
        title: buildToolActionText(item, '搜索资料'),
        subtitle: query
          ? `检索和整理 “${truncateDisplayText(query, 22)}” 相关信息`
          : '从网络中查找当前任务所需信息',
        target: truncateDisplayText(query, 28),
      }
    case 'fetch':
    case 'open':
      return {
        title: buildToolActionText(item, '访问网页内容'),
        subtitle: url ? `打开 ${formatHostLabel(url)} 获取进一步信息` : '读取网页内容以补充上下文',
        target: formatHostLabel(url),
      }
    case 'glob':
    case 'find':
      return {
        title: buildToolActionText(item, '查找相关文件'),
        subtitle: fileLabel ? `定位 ${fileLabel} 附近的相关内容` : '在工作区里查找目标文件',
        target: fileLabel,
      }
    case 'grep':
      return {
        title: buildToolActionText(item, '搜索代码内容'),
        subtitle: query
          ? `检索 “${truncateDisplayText(query, 22)}” 出现的位置`
          : '在项目里搜索关键文本',
        target: truncateDisplayText(query, 28),
      }
    case 'list_dir':
    case 'ls':
      return {
        title: buildToolActionText(item, '查看目录结构'),
        subtitle: fileLabel ? `检查 ${fileLabel} 所在目录的文件分布` : '浏览当前工作区的目录结构',
        target: fileLabel,
      }
    case 'multi_tool_use':
      return {
        title: buildToolActionText(item, '并行处理多个步骤'),
        subtitle: '同时执行多项独立操作以加快任务推进',
        target: '',
      }
    default:
      return {
        title: buildToolActionText(item, getLocalizedToolName(item.tool_name)),
        subtitle: '调用辅助工具推进当前任务',
        target: fileLabel || truncateDisplayText(command || query || url, 28),
      }
  }
}

function formatToolExecutionStatus(item: {
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  kind?: 'tool' | 'workflow_step'
  args_complete?: boolean
  is_error?: boolean
}) {
  if (item.kind === 'workflow_step') {
    if (item.is_error) return '步骤失败'
    if (item.event === 'start') return '执行中'
    if (item.phase === 'completed') return '已完成'
  }
  if (item.phase === 'assembling') {
    return item.args_complete ? '等待执行' : '生成参数中'
  }
  if (item.phase === 'executing') {
    if (item.event === 'start') return '开始执行'
    return '执行中'
  }
  if (item.phase === 'completed') {
    if (item.is_error) return '执行失败'
    return '执行完成'
  }
  if (item.event === 'start') return '开始执行'
  if (item.event === 'update') return '执行中'
  if (item.is_error) return '执行失败'
  return '执行完成'
}

function isToolExecutionActive(item: {
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  is_error?: boolean
}) {
  if (item.is_error) return false
  if (item.phase === 'completed') return false
  return item.event === 'start' || item.event === 'update'
}

function getToolCardClass(item: {
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  is_error?: boolean
}) {
  if (item.is_error) {
    return 'tool-card-error'
  }
  if (isToolExecutionActive(item)) {
    return 'tool-card-active'
  }
  return 'tool-card-complete'
}

function getToolStatusClass(item: {
  event: 'start' | 'update' | 'end'
  phase?: 'assembling' | 'executing' | 'completed'
  is_error?: boolean
}) {
  if (item.is_error) {
    return 'tool-status-error'
  }
  if (isToolExecutionActive(item)) {
    return 'tool-status-active'
  }
  return 'tool-status-complete'
}

function highlightBlock(str: string, lang?: string) {
  const blockId = `code-block-${Date.now()}-${Math.floor(Math.random() * 1000)}`

  // 直接返回带样式的HTML
  return `<pre
    class="max-w-full border border-gray-200 bg-[#AFB8C133] dark:border-gray-700 dark:bg-gray-750 transition-colors"
    id="${blockId}"
    style="line-height: normal; margin: 0 !important; padding: 0 !important; border-radius: 0.75rem !important; width: 100% !important; overflow: hidden !important;"
  ><div class="code-block-header sticky w-full h-10 flex justify-between items-center px-3 border-b border-gray-100 dark:border-gray-700 z-10">
    <span class="text-gray-600 dark:text-gray-400 text-sm font-medium flex items-center">${lang || 'text'}</span>
    <div class="flex gap-2">
      <button class="h-7 gap-1 btn-pill btn-copy" data-block-id="${blockId}">
        <svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="copy-icon text-current"><path d="M13 12.4316V7.8125C13 6.2592 14.2592 5 15.8125 5H40.1875C41.7408 5 43 6.2592 43 7.8125V32.1875C43 33.7408 41.7408 35 40.1875 35H35.5163" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M32.1875 13H7.8125C6.2592 13 5 14.2592 5 15.8125V40.1875C5 41.7408 6.2592 43 7.8125 43H32.1875C33.7408 43 35 41.7408 35 40.1875V15.8125C35 14.2592 33.7408 13 32.1875 13Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
        <svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="check-icon text-current hidden"><path d="M10 24L20 34L40 14" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="copy-text">${t('chat.copyCode')}</span>
        <span class="copied-text hidden">已复制</span>
      </button>
    </div>
  </div><code
    class="hljs code-content-scrollable custom-scrollbar px-4 py-3 text-base bg-white dark:bg-[#282c34] rounded-b-2xl leading-normal code-container"
    style="margin-top: 0; padding-right: 0.75rem !important; padding-left: 0.75rem !important; display: block !important; white-space: pre !important; max-width: 100% !important; width: 100% !important; overflow-x: auto !important;"
  >${str}</code></pre>`
}

async function handleEditMessage() {
  if (isEditable.value) {
    const tempEditableContent = editableContent.value
    await onConversation({
      msg: tempEditableContent,
      imageUrl: props.imageUrl,
      fileUrl: props.fileUrl,
      chatId: props.chatId,
    })

    isEditable.value = false
  } else {
    editableContent.value = props.content
    isEditable.value = true
    await nextTick()
    adjustTextareaHeight()
  }
}

async function handleMessage(item: string) {
  await onConversation({
    msg: item,
  })
}

function handleCopy() {
  emit('copy')
}

function handleDelete() {
  emit('delete')
}

const cancelEdit = () => {
  isEditable.value = false
  editableContent.value = props.content
}

const adjustTextareaHeight = () => {
  if (textarea.value) {
    textarea.value.style.height = 'auto'
    textarea.value.style.height = `${textarea.value.scrollHeight}px`
  }
}

// 新增：监听 loading 状态改变以控制代码块高度
watch(
  () => props.loading,
  isLoading => {
    // 仅处理非用户消息
    if (props.isUserMessage) return

    nextTick(() => {
      const container = textRef.value
      if (container) {
        const codeElements = container.querySelectorAll('code.code-content-scrollable')
        codeElements.forEach(element => {
          const codeEl = element as HTMLElement
          const parentDiv = codeEl.parentElement

          if (!isLoading) {
            // 加载完成: 设置最大高度和滚动
            codeEl.style.maxHeight = '50vh'
            codeEl.style.overflowY = 'auto'
            codeEl.style.display = 'block !important' // 确保 code 是块级元素以应用高度和滚动
            codeEl.style.whiteSpace = 'pre !important'
            codeEl.style.minWidth = 'fit-content !important'

            if (parentDiv && parentDiv.classList.contains('custom-scrollbar')) {
              parentDiv.style.overflowX = 'auto !important'
              parentDiv.style.maxWidth = '100% !important'
            }

            // 确保滚动条可见
            setTimeout(() => {
              // 强制重新计算布局，确保滚动条显示
              codeEl.style.overflow = 'hidden'
              void codeEl.offsetHeight // 触发回流
              codeEl.style.overflowY = 'auto'

              if (parentDiv) {
                void parentDiv.offsetHeight
                parentDiv.style.overflowX = 'auto !important'
              }
            }, 100)
          } else {
            // 正在加载: 移除限制，允许内容扩展
            codeEl.style.maxHeight = 'none'
            codeEl.style.overflowY = 'visible' // 或者 hidden，取决于是否希望看到溢出
            // display: block 可以在 CSS 中设置或在这里保留
            codeEl.style.display = 'block !important'
            codeEl.style.whiteSpace = 'pre !important'
          }
        })
      }
    })
  },
  { immediate: true } // 初始渲染时也根据 loading 状态设置一次
)

// 在watch中监听editableContent的变化
watch(editableContent, () => {
  if (isEditable.value) {
    nextTick(() => {
      adjustTextareaHeight()
    })
  }
})

// 监听isEditable状态变化，确保切换到编辑模式时调整高度
watch(isEditable, newVal => {
  if (newVal) {
    nextTick(() => {
      adjustTextareaHeight()
    })
  }
})

// 监听深度思考状态，自动折叠完成的深度思考内容
// watch(
//   [
//     () => props.reasoningText,
//     () => props.content,
//     () => props.loading,
//     () => props.usingDeepThinking,
//   ],
//   (
//     [newReasoningText, newContent, newLoading, newUsingDeepThinking],
//     [oldReasoningText, oldContent, oldLoading, oldUsingDeepThinking]
//   ) => {
//     // 如果有深度思考内容且当前是展开状态
//     if (newReasoningText && showThinking.value && !props.isUserMessage) {
//       // 情况1：深度思考完成（loading从true变为false）
//       // 情况2：开始有正文内容（从无到有）
//       // 情况3：不再使用深度思考且有正文内容
//       if (
//         (oldLoading && !newLoading && newReasoningText) ||
//         (!oldContent && newContent && newReasoningText) ||
//         (oldUsingDeepThinking && !newUsingDeepThinking && newContent)
//       ) {
//         // 延迟2秒后自动折叠，给用户时间看到完成状态
//         setTimeout(() => {
//           showThinking.value = false
//         }, 1000)
//       }
//     }
//   },
//   { immediate: false }
// )

defineExpose({ textRef })

onMounted(() => {
  // 注入主题覆盖样式
  injectThemeStyles()
  startThemeObserver()

  // 添加复制功能
  const setupCodeCopy = () => {
    console.log('设置代码复制功能')
    // 选择包含btn-copy类的按钮
    const copyButtons = document.querySelectorAll('.btn-copy[data-block-id]')
    copyButtons.forEach(button => {
      const blockId = button.getAttribute('data-block-id')
      if (!blockId) return

      // 检查按钮是否已经绑定了事件（添加自定义属性标记）
      if (button.getAttribute('data-listener-attached') === 'true') {
        return
      }

      // 添加新的事件处理程序
      button.addEventListener('click', event => {
        event.stopPropagation()
        event.preventDefault()
        console.log('复制按钮被点击, blockId:', blockId)
        handleCodeCopy(blockId, button as HTMLElement)
      })

      // 标记按钮已绑定事件
      button.setAttribute('data-listener-attached', 'true')
    })
  }

  // 初始设置和DOM更新后重新设置
  setupCodeCopy()

  // 监听DOM变化，当新的代码块出现时设置复制功能
  const observer = new MutationObserver(mutations => {
    // 检查是否有新的代码块按钮被添加
    let hasNewButtons = false
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            // 元素节点
            const element = node as HTMLElement
            // 检查是否包含未绑定事件的复制按钮
            const newButtons = element.querySelectorAll(
              '.btn-copy:not([data-listener-attached="true"])'
            )
            if (newButtons.length > 0) {
              hasNewButtons = true
            }
          }
        })
      }
    })

    // 只有在确实有新按钮时才执行设置
    if (hasNewButtons) {
      setupCodeCopy()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 卸载时清理
  onUnmounted(() => {
    observer.disconnect()
    // 清理所有定时器
    copyTimeoutsMap.forEach(timeoutId => clearTimeout(timeoutId))
    copyTimeoutsMap.clear()
  })

  const handlePreviewClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    // 查找包含btn-preview类的按钮或其父元素
    const previewButton = target.classList?.contains('btn-preview')
      ? target
      : target.closest('.btn-preview')

    if (previewButton && previewButton.getAttribute('data-block-id')) {
      event.stopPropagation()
      event.preventDefault()

      const blockId = previewButton.getAttribute('data-block-id')
      if (blockId) {
        const codeBlock = document.getElementById(blockId)
        if (codeBlock) {
          const codeElement = codeBlock.querySelector('code')
          if (codeElement && codeElement.textContent) {
            // 检查是否是Mermaid图表
            const isMermaid = previewButton.classList.contains('preview-mermaid')
            // 更新当前点击的内容到全局存储，标记类型
            globalStore.updateHtmlContent(
              codeElement.textContent || '',
              isMermaid ? 'mermaid' : 'html'
            )
            // 打开预览器，由预览器自动收集所有代码块
            globalStore.updateHtmlPreviewer(true)
          }
        }
      }
    }
  }

  document.addEventListener('click', handlePreviewClick)

  // 添加对markdown图片的预览监听
  const handleMdImagePreview = (event: CustomEvent) => {
    const { src } = event.detail
    openSingleImagePreview(src)
  }

  document.addEventListener('previewMdImage', handleMdImagePreview as EventListener)

  onUnmounted(() => {
    document.removeEventListener('click', handlePreviewClick)
    document.removeEventListener('previewMdImage', handleMdImagePreview as EventListener)
  })

  // 初始化代码块样式
  nextTick(() => {
    const container = textRef.value
    if (container) {
      const codeElements = container.querySelectorAll('code.code-content-scrollable')
      codeElements.forEach(element => {
        const codeEl = element as HTMLElement
        const parentDiv = codeEl.parentElement

        // 设置样式
        codeEl.style.maxHeight = '50vh'
        codeEl.style.overflowY = 'auto'
        codeEl.style.display = 'block !important'
        codeEl.style.whiteSpace = 'pre !important'
        codeEl.style.minWidth = 'fit-content !important'

        if (parentDiv && parentDiv.classList.contains('custom-scrollbar')) {
          parentDiv.style.overflowX = 'auto !important'
          parentDiv.style.maxWidth = '100% !important'
        }

        // 确保滚动条可见
        setTimeout(() => {
          // 强制重新计算布局，确保滚动条显示
          codeEl.style.overflow = 'hidden'
          void codeEl.offsetHeight // 触发回流
          codeEl.style.overflowY = 'auto'

          if (parentDiv) {
            void parentDiv.offsetHeight
            parentDiv.style.overflowX = 'auto !important'
          }
        }, 100)
      })
    }
  })

  // 停止音频播放并清理资源
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }

  if (speechSynthesisUtterance) {
    window.speechSynthesis.cancel()
  }

  // 监听 code button 点击事件
  setTimeout(() => {
    // 预览按钮
    const htmlPreviewBtns = document.querySelectorAll(
      '.btn-preview:not(.preview-mermaid):not(.preview-markmap)'
    )
    const mermaidPreviewBtns = document.querySelectorAll('.preview-mermaid')
    const markmapPreviewBtns = document.querySelectorAll('.preview-markmap')
    const copyBtns = document.querySelectorAll('.btn-copy')

    // HTML预览按钮点击处理
    htmlPreviewBtns.forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        // 获取代码块ID
        const blockId = (e.currentTarget as HTMLElement).dataset.blockId || ''
        const codeBlock = document.getElementById(blockId)
        if (codeBlock && codeBlock.querySelector('code')) {
          const code = codeBlock.querySelector('code')?.textContent || ''
          globalStore.updateHtmlContent(code, 'html')
          globalStore.updateHtmlPreviewer(true)
        }
      })
    })

    // Mermaid预览按钮点击处理
    mermaidPreviewBtns.forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        // 获取代码块ID
        const blockId = (e.currentTarget as HTMLElement).dataset.blockId || ''
        const codeBlock = document.getElementById(blockId)
        if (codeBlock && codeBlock.querySelector('code')) {
          const code = codeBlock.querySelector('code')?.textContent || ''
          globalStore.updateHtmlContent(code, 'mermaid')
          globalStore.updateHtmlPreviewer(true)
        }
      })
    })

    // Markmap预览按钮点击处理
    markmapPreviewBtns.forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        // 获取代码块ID
        const blockId = (e.currentTarget as HTMLElement).dataset.blockId || ''
        const codeBlock = document.getElementById(blockId)
        if (codeBlock && codeBlock.querySelector('code')) {
          const code = codeBlock.querySelector('code')?.textContent || ''
          globalStore.updateHtmlContent(code, 'markmap')
          globalStore.updateHtmlPreviewer(true)
        }
      })
    })

    // Copy button click handlers
    copyBtns.forEach(btn => {
      btn.addEventListener('click', (e: Event) => {
        const blockId = (e.currentTarget as HTMLElement).dataset.blockId || ''
        const codeBlock = document.getElementById(blockId)
        if (codeBlock && codeBlock.querySelector('code')) {
          const code = codeBlock.querySelector('code')?.textContent || ''
          // 复制代码到剪贴板
          navigator.clipboard.writeText(code).then(() => {
            const copyBtn = e.currentTarget as HTMLElement
            // const copyIcon = copyBtn.querySelector('.copy-icon')
            const originalHTML = copyBtn.innerHTML

            // 显示成功状态
            copyBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="text-green-500">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M4 24L9 19L19 29L39 9L44 14L19 39L4 24Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                已复制
              `

            // 2秒后恢复原样
            setTimeout(() => {
              copyBtn.innerHTML = originalHTML
            }, 2000)
          })
          // .catch(() => {
          //   // 复制失败处理
          //   alert('复制失败，请手动复制')
          // })
        }
      })
    })
  }, 100)
})

onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
})

function openImagePreview(index: number) {
  // 通知父组件打开预览器
  if (onOpenImagePreviewer && imageUrlArray.value.length > 0) {
    onOpenImagePreviewer(imageUrlArray.value, index)
  }
}

// 打开单张图片预览
function openSingleImagePreview(src: string) {
  if (onOpenImagePreviewer) {
    onOpenImagePreviewer([src], 0)
  }
}
</script>

<template>
  <div class="text-wrap flex w-full flex-col px-1 group">
    <!-- 网页搜索结果 -->
    <div v-if="!isUserMessage && (searchResult.length || (loading && usingNetwork))" class="mb-2">
      <div
        @click="showSearchResult = !showSearchResult"
        class="text-gray-600 mb-1 cursor-pointer items-center btn-pill glow-container"
      >
        <Sphere theme="outline" size="18" class="mr-1 flex" />
        <span v-if="searchResult.length">已浏览 {{ searchResult.length }} 个网页</span>
        <span v-else-if="loading && usingNetwork">联网搜索中</span>
        <LoadingOne v-if="loading && usingNetwork" class="rotate-icon flex mx-1" />
        <Down v-if="!showSearchResult && searchResult.length" size="18" class="ml-1 flex" />
        <Up v-else-if="searchResult.length" size="18" class="ml-1 flex" />
        <div v-if="loading && usingNetwork && !searchResult.length" class="glow-band"></div>
      </div>

      <transition name="fold">
        <div
          v-if="showSearchResult && searchResult.length"
          class="text-gray-600 dark:text-gray-400 border-l-2 pl-5 mt-2"
        >
          <div class="flex flex-col gap-2 text-base">
            <a
              v-for="(item, index) in searchResult"
              :key="index"
              :href="item.link"
              target="_blank"
              class="hover:underline mr-2 text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-300"
            >
              {{ index + 1 }}. {{ item.title.slice(0, 80)
              }}{{ item.title.length > 80 ? '...' : '' }}
              <span v-if="item.media">[{{ item.media }}]</span>
            </a>
          </div>
        </div>
      </transition>
    </div>

    <!-- 深度思考内容 -->
    <div v-if="!isUserMessage && (reasoningText || (loading && usingDeepThinking))" class="mb-2">
      <div
        @click="showThinking = !showThinking"
        class="text-gray-600 mb-1 cursor-pointer items-center btn-pill glow-container"
      >
        <TwoEllipses theme="outline" size="18" class="mr-1 flex" />
        <span v-if="reasoningText">{{ text || !loading ? '已深度思考' : '深度思考中' }}</span>
        <span v-else-if="loading && usingDeepThinking">深度思考</span>
        <LoadingOne
          v-if="
            (loading && usingDeepThinking && !reasoningText) || (!text && loading && reasoningText)
          "
          class="rotate-icon flex mx-1"
        />
        <Down v-if="!showThinking && reasoningText" size="18" class="ml-1 flex" />
        <Up v-else-if="reasoningText" size="18" class="ml-1 flex" />
        <div
          v-if="
            (loading && usingDeepThinking && !reasoningText) || (!text && loading && reasoningText)
          "
          class="glow-band"
        ></div>
      </div>

      <transition name="fold">
        <div
          v-if="showThinking && reasoningText"
          :class="[
            'markdown-body text-gray-600 dark:text-gray-400 pl-5 mt-2 border-l-2 border-gray-300 dark:border-gray-600 overflow-hidden transition-opacity duration-500 ease-in-out',
            { 'markdown-body-generate': loading && !text },
          ]"
          v-html="reasoningText"
        ></div>
      </transition>
    </div>

    <div
      v-if="!isUserMessage && parsedToolExecution.length && !hasOrderedStreamSegments"
      class="mb-2"
    >
      <div
        @click="showToolExecution = !showToolExecution"
        class="text-gray-600 mb-1 cursor-pointer items-center btn-pill glow-container"
      >
        <Sphere theme="outline" size="18" class="mr-1 flex" />
        <span>{{ toolExecutionSummary }}</span>
        <Down v-if="!showToolExecution" size="18" class="ml-1 flex" />
        <Up v-else size="18" class="ml-1 flex" />
      </div>
      <transition name="fold">
        <div
          v-if="showToolExecution"
          class="pl-5 mt-2 border-l-2 border-gray-300 dark:border-gray-600 flex flex-col gap-2"
        >
          <div
            v-for="item in parsedToolExecution"
            :key="item.tool_call_id"
            :class="[
              'tool-card rounded-2xl border px-3 py-3 text-sm transition-all duration-300',
              getToolCardClass(item),
            ]"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <span :class="['tool-status-dot', getToolStatusClass(item)]"></span>
                <div class="tool-card-title font-medium text-gray-800 dark:text-gray-100">
                  {{ getToolExecutionDisplay(item).title }}
                </div>
              </div>
              <div :class="['tool-status-pill shrink-0 text-xs', getToolStatusClass(item)]">
                {{ formatToolExecutionStatus(item) }}
              </div>
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <div class="tool-card-subtitle break-words text-xs">
                {{ getToolExecutionDisplay(item).subtitle }}
              </div>
              <div v-if="getToolExecutionDisplay(item).target" class="tool-card-tag">
                {{ getToolExecutionDisplay(item).target }}
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- 主文本内容 -->
    <div ref="textRef" class="flex w-full">
      <!-- AI回复内容 -->
      <div v-if="!isUserMessage" class="w-full">
        <span
          v-if="loading && !text && !reasoningText && !hasOrderedStreamSegments"
          class="inline-block w-3.5 h-3.5 ml-0.5 align-middle rounded-full animate-breathe dark:bg-gray-100 bg-gray-950"
        ></span>
        <div v-if="hasOrderedStreamSegments" class="flex flex-col gap-3">
          <template v-for="segment in parsedStreamSegments" :key="segment.id">
            <div
              v-if="segment.type === 'text'"
              :class="[
                'markdown-body text-gray-950 dark:text-gray-100',
                { 'markdown-body-generate': loading || !segment.text },
              ]"
              v-html="renderAssistantMarkdown(segment.text)"
            ></div>
            <div
              v-else
              :class="[
                'tool-card rounded-2xl border px-3 py-3 text-sm transition-all duration-300',
                getToolCardClass(segment),
              ]"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <span :class="['tool-status-dot', getToolStatusClass(segment)]"></span>
                  <div class="tool-card-title font-medium text-gray-800 dark:text-gray-100">
                    {{ getToolExecutionDisplay(segment).title }}
                  </div>
                </div>
                <div :class="['tool-status-pill shrink-0 text-xs', getToolStatusClass(segment)]">
                  {{ formatToolExecutionStatus(segment) }}
                </div>
              </div>
              <div class="mt-2 flex flex-col gap-2">
                <div class="tool-card-subtitle break-words text-xs">
                  {{ getToolExecutionDisplay(segment).subtitle }}
                </div>
                <div v-if="getToolExecutionDisplay(segment).target" class="tool-card-tag">
                  {{ getToolExecutionDisplay(segment).target }}
                </div>
              </div>
            </div>
          </template>
        </div>
        <div
          v-if="!hasOrderedStreamSegments"
          :class="[
            'markdown-body text-gray-950 dark:text-gray-100',
            { 'markdown-body-generate': loading || !text },
          ]"
          v-html="text"
        ></div>

        <div
          v-if="shouldShowArtifactSummary"
          class="artifact-summary-wrap"
          :class="{ 'artifact-summary-wrap-dark': isDarkTheme }"
          :style="artifactSummaryThemeVars"
        >
          <button
            v-for="file in markdownArtifactFiles"
            :key="file.path"
            class="artifact-markdown-preview-card"
            @click="openArtifactPreview(file.path)"
          >
            <div class="artifact-markdown-preview-head">
              <div class="artifact-summary-icon artifact-summary-icon-primary">
                <DocDetail size="22" />
              </div>
              <div class="min-w-0 text-left">
                <div class="artifact-summary-name">
                  {{ file.name }}
                </div>
                <div class="artifact-summary-meta">
                  Markdown 文档 · {{ formatArtifactSize(file.size) }}
                </div>
              </div>
              <span class="artifact-markdown-more">···</span>
            </div>

            <div
              class="artifact-markdown-preview-body"
              v-html="renderArtifactMarkdownPreview(file)"
            ></div>
          </button>

          <div v-if="compactArtifactFiles.length" class="artifact-summary-cards">
            <button
              v-for="file in compactArtifactFiles"
              :key="file.path"
              class="artifact-summary-card"
              @click="openArtifactPreview(file.path)"
            >
              <div class="artifact-summary-icon artifact-summary-icon-primary">
                <FileCode v-if="file.type === 'html'" size="22" />
                <DocDetail v-else size="22" />
              </div>
              <div class="min-w-0 text-left">
                <div class="artifact-summary-name">
                  {{ file.name }}
                </div>
                <div class="artifact-summary-meta">
                  {{ artifactTypeLabel(file) }} ·
                  {{ formatArtifactSize(file.size) }}
                </div>
              </div>
            </button>
          </div>

          <div v-if="!loading" class="artifact-summary-finish">
            <CheckOne theme="filled" size="16" />
            <span>
              任务已完成
              <template v-if="hiddenArtifactCount">
                · 已收起 {{ hiddenArtifactCount }} 个辅助文件，可在“所有文件”中查看
              </template>
            </span>
          </div>
        </div>
      </div>

      <!-- 用户消息内容 -->
      <div
        v-else
        class="flex justify-end w-full"
        :class="[isMobile ? 'pl-20' : 'pl-28']"
        style="max-width: 100%"
      >
        <!-- 编辑模式 -->
        <div
          v-if="isEditable"
          class="p-3 rounded-2xl w-full bg-opacity dark:bg-gray-750 break-words"
          style="max-width: 100%"
        >
          <textarea
            v-model="editableContent"
            class="min-w-full text-base resize-none overflow-y-auto bg-transparent whitespace-pre-wrap text-gray-950 dark:text-gray-100"
            style="max-height: 60vh"
            @input="adjustTextareaHeight"
            ref="textarea"
          ></textarea>
          <div class="flex justify-end mt-3">
            <!-- 取消按钮 -->
            <div class="group relative">
              <button
                type="button"
                class="btn-floating btn-md mx-3"
                :class="{
                  'h-8 w-8': isMobile,
                  'bg-[#F4F4F4] border-[#F4F4F4] dark:bg-[#2f2f2f] dark:border-[#2f2f2f]': isMobile,
                }"
                @click="cancelEdit"
                aria-label="取消"
              >
                <Close size="16" />
              </button>
              <div v-if="!isMobile" class="tooltip tooltip-top">取消</div>
            </div>
            <!-- 发送按钮 -->
            <div class="group relative">
              <button
                type="button"
                class="btn-send"
                :class="{ 'h-8 w-8': isMobile }"
                @click="handleEditMessage"
                aria-label="发送"
              >
                <Send size="16" />
              </button>
              <div v-if="!isMobile" class="tooltip tooltip-top">发送</div>
            </div>
          </div>
        </div>
        <!-- 只读模式 -->
        <div
          v-else
          class="p-3 rounded-2xl text-base bg-opacity dark:bg-gray-750 break-words whitespace-pre-wrap text-gray-950 dark:text-gray-100"
          v-text="text"
          style="max-width: 100%"
        />
      </div>
    </div>

    <!-- 图片显示部分 -->
    <div
      v-if="imageUrlArray && imageUrlArray.length > 0 && isImageUrl"
      :class="['my-2 w-full flex', isUserMessage ? 'justify-end' : 'justify-start']"
    >
      <div
        class="gap-2"
        :style="{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(imageUrlArray.length, 4)}, 1fr)`,
          gridAutoRows: '1fr',
          maxWidth: isUserMessage ? (isMobile ? '60vw' : '40vw') : '80vw',
          width: 'auto',
        }"
      >
        <img
          v-for="(file, index) in imageUrlArray"
          :key="index"
          :src="file"
          alt="图片"
          @click="openImagePreview(index)"
          class="rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-90 transition-opacity w-auto h-auto max-h-[30vh] object-cover"
          :style="{
            aspectRatio: '1/1',
            width: '160px',
            height: '160px',
          }"
        />
      </div>
    </div>

    <!-- 后续提问建议 -->
    <div
      v-if="promptReference && !isUserMessage && isLast"
      class="flex-row transition-opacity duration-500"
    >
      <button
        v-for="(item, index) in promptReference
          ? promptReference
              .match(/{(.*?)}/g)
              ?.map((str: string | any[]) => str.slice(1, -1))
              .slice(0, 3)
          : []"
        :key="index"
        @click="handleMessage(item as string)"
        class="flex items-center overflow-hidden btn-pill py-4 px-4 mt-3"
      >
        {{ item }}
        <ArrowRight class="ml-1" />
      </button>
    </div>

    <!-- 操作按钮区域 -->
    <div
      :class="[
        'flex transition-opacity duration-300 text-gray-700',
        buttonGroupClass,
        { 'justify-end': isUserMessage },
      ]"
    >
      <div class="mt-2 flex group">
        <!-- 复制按钮 -->
        <div v-if="!isEditable" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="handleCopy"
            aria-label="复制"
          >
            <Copy />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">{{ t('chat.copy') }}</div>
        </div>

        <!-- 删除按钮 -->
        <div v-if="!isEditable" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="handleDelete"
            aria-label="删除"
          >
            <Delete />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">{{ t('chat.delete') }}</div>
        </div>

        <!-- 编辑按钮 -->
        <div v-if="isUserMessage && !isEditable" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="handleEditMessage"
            aria-label="编辑"
          >
            <Edit />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">编辑</div>
        </div>

        <!-- 重新生成按钮 -->
        <div v-if="!isUserMessage" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="handleRegenerate(index, chatId)"
            aria-label="重新生成"
          >
            <Refresh />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">重新生成</div>
        </div>

        <!-- 朗读按钮 -->
        <div v-if="!isUserMessage && !isHideTts" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="playOrPause"
            aria-label="朗读"
          >
            <VoiceMessage v-if="playbackState === 'paused'" />
            <Rotation v-if="playbackState === 'loading'" class="rotate-icon" />
            <PauseOne v-else-if="playbackState === 'playing'" />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">
            {{
              playbackState === 'playing'
                ? t('chat.pause')
                : playbackState === 'loading'
                  ? t('chat.loading')
                  : t('chat.readAloud')
            }}
          </div>
        </div>

        <!-- 浏览器朗读按钮 -->
        <div v-if="!isUserMessage && isHideTts" class="relative group-btn">
          <button
            class="btn-icon btn-sm btn-icon-action mx-1"
            @click="handleBrowserTts"
            aria-label="浏览器朗读"
          >
            <Sound v-if="browserTtsState === 'paused'" />
            <PauseOne v-else-if="browserTtsState === 'playing'" />
          </button>
          <div v-if="!isMobile" class="tooltip tooltip-top">
            {{ browserTtsState === 'playing' ? '停止' : '朗读' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
/* 
  注意：主要的highlight.js主题覆盖已移至 injectThemeStyles 函数
  此处只保留动画和其他非主题相关样式
*/

@keyframes rotateAnimation {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.rotate-icon {
  animation: rotateAnimation 3s linear infinite;
  transform-origin: center;
}

.hidden {
  display: none !important;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.new-text-fade-in {
  animation: fadeIn 0.5s ease-in;
  animation-fill-mode: forwards;
  display: inline;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
    /* 原始尺寸 */
    opacity: 1;
    /* 完全不透明 */
  }

  50% {
    transform: scale(0.5);
    /* 缩小到50%的尺寸 */
    opacity: 0.5;
    /* 半透明 */
  }
}

.animate-breathe {
  animation: breathe 2s infinite ease-in-out;
}

/* 折叠/展开动画 */
.fold-enter-active,
.fold-leave-active {
  transition: all 0.3s ease;
  max-height: 1000px;
  opacity: 1;
  overflow: hidden;
}

.fold-enter-from,
.fold-leave-to {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
}

/* 为响应结果折叠添加特殊处理 */
pre.fold-enter-active,
pre.fold-leave-active {
  transition: all 0.25s ease;
  max-height: 500px;
  opacity: 1;
  margin-top: 0.5rem;
}

pre.fold-enter-from,
pre.fold-leave-to {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
}

/* 使用全局样式配置，在global.less中定义 */

/* Markdown样式 */
.markdown-body {
  background-color: transparent;
  // font-size: 1rem;
  max-width: min(50rem, 100%);

  // p {
  //   white-space: pre-wrap;
  // }

  // ol {
  //   list-style-type: decimal;
  // }

  // ul {
  //   list-style-type: disc;
  // }

  pre code,
  pre tt {
    line-height: 1.65;
  }
}

.pi-tool-renderer {
  line-height: 1.55;
}

.pi-tool-renderer .ansi-line {
  min-height: 1.55em;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 深色模式滚动条 */
.dark .custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(107, 114, 128, 0.9);
}

/* 代码容器高度控制 */
.code-container {
  transition:
    max-height 0.3s ease,
    overflow 0.3s ease;
  overflow: auto;
  max-width: 100% !important;
  overflow-x: auto !important;
  width: 100% !important;
}

/* 生成完成状态下的代码容器限制高度 */
.markdown-body:not(.markdown-body-generate) .code-container {
  max-height: 50vh;
  overflow-y: auto;
}

/* 生成中状态下的代码容器不限制高度 */
.markdown-body-generate .code-container {
  max-height: none;
  overflow-y: visible;
}

/* 加载动画样式 */
.tool-card {
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(12px);
  transform: translateY(0);
}

.tool-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.tool-card:hover {
  transform: translateY(-1px);
}

.tool-card-active {
  border-color: rgba(59, 130, 246, 0.22);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.92)),
    rgba(255, 255, 255, 0.82);
  box-shadow:
    0 0 0 1px rgba(191, 219, 254, 0.45),
    0 14px 34px rgba(59, 130, 246, 0.1);
}

.dark .tool-card-active {
  border-color: rgba(56, 189, 248, 0.28);
  background:
    linear-gradient(135deg, rgba(17, 24, 39, 0.96), rgba(12, 34, 56, 0.92)), rgba(15, 23, 42, 0.88);
  box-shadow:
    0 0 0 1px rgba(56, 189, 248, 0.16),
    0 16px 40px rgba(14, 165, 233, 0.16);
}

.tool-card-active::before {
  opacity: 1;
  background: linear-gradient(
    115deg,
    transparent 18%,
    rgba(255, 255, 255, 0.05) 32%,
    rgba(255, 255, 255, 0.5) 48%,
    rgba(255, 255, 255, 0.06) 64%,
    transparent 82%
  );
  transform: translateX(-130%);
  animation: tool-card-shimmer 3s ease-in-out infinite;
}

.tool-card-complete {
  border-color: rgba(209, 213, 219, 0.9);
  background: rgba(249, 250, 251, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.dark .tool-card-complete {
  border-color: rgba(55, 65, 81, 0.9);
  background: rgba(31, 41, 55, 0.76);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.tool-card-error {
  border-color: rgba(248, 113, 113, 0.32);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(254, 242, 242, 0.92)),
    rgba(255, 255, 255, 0.82);
  box-shadow:
    0 0 0 1px rgba(254, 202, 202, 0.55),
    0 14px 32px rgba(239, 68, 68, 0.08);
}

.dark .tool-card-error {
  border-color: rgba(248, 113, 113, 0.3);
  background:
    linear-gradient(135deg, rgba(31, 18, 18, 0.96), rgba(69, 10, 10, 0.84)), rgba(24, 24, 27, 0.88);
  box-shadow:
    0 0 0 1px rgba(248, 113, 113, 0.12),
    0 16px 40px rgba(127, 29, 29, 0.18);
}

.tool-status-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  flex-shrink: 0;
}

.tool-status-active {
  color: rgb(29, 78, 216);
  background: rgba(59, 130, 246, 0.14);
}

.tool-status-dot.tool-status-active {
  background: radial-gradient(circle, #38bdf8 0%, #2563eb 72%);
  box-shadow:
    0 0 0 0 rgba(59, 130, 246, 0.35),
    0 0 16px rgba(56, 189, 248, 0.45);
  animation: tool-status-pulse 1.8s ease-in-out infinite;
}

.dark .tool-status-active {
  color: rgb(186, 230, 253);
  background: rgba(14, 165, 233, 0.18);
}

.tool-status-complete {
  color: rgb(55, 65, 81);
  background: rgba(107, 114, 128, 0.1);
}

.tool-status-dot.tool-status-complete {
  background: radial-gradient(circle, #9ca3af 0%, #6b7280 72%);
}

.dark .tool-status-complete {
  color: rgb(209, 213, 219);
  background: rgba(107, 114, 128, 0.18);
}

.tool-status-error {
  color: rgb(185, 28, 28);
  background: rgba(248, 113, 113, 0.14);
}

.tool-status-dot.tool-status-error {
  background: radial-gradient(circle, #f87171 0%, #dc2626 72%);
  box-shadow: 0 0 14px rgba(248, 113, 113, 0.28);
}

.dark .tool-status-error {
  color: rgb(254, 202, 202);
  background: rgba(248, 113, 113, 0.14);
}

.tool-status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 1.6rem;
  border-radius: 9999px;
  padding: 0.1rem 0.6rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.tool-card-title {
  line-height: 1.3;
}

.tool-card-subtitle {
  color: rgb(107, 114, 128);
  line-height: 1.45;
}

.dark .tool-card-subtitle {
  color: rgb(156, 163, 175);
}

.tool-card-tag {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(241, 245, 249, 0.88);
  color: rgb(71, 85, 105);
  padding: 0.28rem 0.65rem;
  font-size: 0.72rem;
  line-height: 1.2;
  word-break: break-all;
}

.dark .tool-card-tag {
  border-color: rgba(71, 85, 105, 0.7);
  background: rgba(30, 41, 59, 0.76);
  color: rgb(191, 219, 254);
}

.artifact-summary-wrap {
  margin-top: 1rem;
  --artifact-summary-card-bg: rgba(255, 255, 255, 0.92);
  --artifact-summary-card-hover: rgba(248, 250, 252, 0.98);
  --artifact-summary-border: rgba(15, 23, 42, 0.1);
  --artifact-summary-border-hover: rgba(37, 99, 235, 0.28);
  --artifact-summary-text: #111827;
  --artifact-summary-muted: rgba(51, 65, 85, 0.66);
  --artifact-summary-soft: rgba(15, 23, 42, 0.045);
  --artifact-summary-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
  --artifact-summary-gradient-start: rgba(255, 255, 255, 0);
  --artifact-summary-gradient-mid: rgba(255, 255, 255, 0.72);
  --artifact-summary-gradient-end: #ffffff;
  --artifact-summary-code-bg: rgba(15, 23, 42, 0.06);
}

html.dark .artifact-summary-wrap,
html[data-theme='dark'] .artifact-summary-wrap,
.artifact-summary-wrap-dark {
  --artifact-summary-card-bg: rgba(24, 24, 27, 0.94);
  --artifact-summary-card-hover: rgba(39, 39, 42, 0.96);
  --artifact-summary-border: rgba(255, 255, 255, 0.11);
  --artifact-summary-border-hover: rgba(96, 165, 250, 0.34);
  --artifact-summary-text: #f8fafc;
  --artifact-summary-muted: rgba(226, 232, 240, 0.62);
  --artifact-summary-soft: rgba(255, 255, 255, 0.07);
  --artifact-summary-shadow: 0 18px 52px rgba(0, 0, 0, 0.34);
  --artifact-summary-gradient-start: rgba(24, 24, 27, 0);
  --artifact-summary-gradient-mid: rgba(24, 24, 27, 0.72);
  --artifact-summary-gradient-end: #18181b;
  --artifact-summary-code-bg: rgba(255, 255, 255, 0.09);
}

.artifact-summary-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  max-width: min(100%, 44rem);
}

.artifact-summary-card {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: min(100%, 22rem);
  min-height: 5.35rem;
  border-radius: 1.3rem;
  border: 1px solid var(--artifact-summary-border);
  background: var(--artifact-summary-card-bg);
  padding: 0.95rem 1.08rem;
  color: var(--artifact-summary-text);
  box-shadow: var(--artifact-summary-shadow);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.artifact-summary-card:hover {
  transform: translateY(-1px);
  border-color: var(--artifact-summary-border-hover);
  background: var(--artifact-summary-card-hover);
}

.artifact-summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.9rem;
  flex-shrink: 0;
}

.artifact-summary-icon-primary {
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.92), rgba(59, 130, 246, 0.92));
  color: white;
}

.artifact-summary-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--artifact-summary-text);
}

.artifact-summary-meta {
  margin-top: 0.2rem;
  font-size: 0.82rem;
  color: var(--artifact-summary-muted);
}

.artifact-markdown-preview-card {
  display: block;
  width: min(46rem, 100%);
  overflow: hidden;
  border-radius: 1.35rem;
  border: 1px solid var(--artifact-summary-border);
  background: var(--artifact-summary-card-bg);
  color: var(--artifact-summary-text);
  text-align: left;
  box-shadow: var(--artifact-summary-shadow);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.artifact-markdown-preview-card:hover {
  transform: translateY(-1px);
  border-color: var(--artifact-summary-border-hover);
  background: var(--artifact-summary-card-hover);
}

.artifact-markdown-preview-card + .artifact-markdown-preview-card,
.artifact-markdown-preview-card + .artifact-summary-cards {
  margin-top: 1rem;
}

.artifact-markdown-preview-head {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 5rem;
  border-bottom: 1px solid var(--artifact-summary-border);
  padding: 0.95rem 1.15rem;
}

.artifact-markdown-more {
  margin-left: auto;
  color: var(--artifact-summary-muted);
  font-size: 1.18rem;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.artifact-markdown-preview-body {
  position: relative;
  max-height: 17rem;
  overflow: hidden;
  padding: 1.1rem 1.45rem 2.2rem;
  font-size: 0.95rem;
  line-height: 1.66;
  pointer-events: none;
}

.artifact-markdown-preview-body::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 4.25rem;
  content: '';
  backdrop-filter: blur(0.45px);
  background: linear-gradient(
    180deg,
    var(--artifact-summary-gradient-start),
    var(--artifact-summary-gradient-mid) 58%,
    var(--artifact-summary-gradient-end) 100%
  );
}

.artifact-markdown-preview-body :deep(h1),
.artifact-markdown-preview-body :deep(h2),
.artifact-markdown-preview-body :deep(h3),
.artifact-markdown-preview-body :deep(h4),
.artifact-markdown-preview-body :deep(h5),
.artifact-markdown-preview-body :deep(h6),
.artifact-markdown-preview-body :deep(p),
.artifact-markdown-preview-body :deep(li),
.artifact-markdown-preview-body :deep(strong),
.artifact-markdown-preview-body :deep(em) {
  color: var(--artifact-summary-text);
}

.artifact-markdown-preview-body :deep(h1) {
  margin-top: 0;
  margin-bottom: 0.75rem;
  font-size: 1.18rem !important;
  line-height: 1.35 !important;
}

.artifact-markdown-preview-body :deep(h2) {
  margin-top: 1.1rem;
  margin-bottom: 0.55rem;
  font-size: 1.05rem !important;
  line-height: 1.38 !important;
}

.artifact-markdown-preview-body :deep(h3),
.artifact-markdown-preview-body :deep(h4),
.artifact-markdown-preview-body :deep(h5),
.artifact-markdown-preview-body :deep(h6) {
  margin-top: 0.85rem;
  margin-bottom: 0.45rem;
  font-size: 0.96rem !important;
  line-height: 1.42 !important;
}

.artifact-markdown-preview-body :deep(p),
.artifact-markdown-preview-body :deep(li) {
  color: var(--artifact-summary-text);
  font-size: 0.93rem !important;
  line-height: 1.66 !important;
}

.artifact-markdown-preview-body :deep(ul),
.artifact-markdown-preview-body :deep(ol) {
  margin: 0.65rem 0;
  padding-left: 1.4rem;
}

.artifact-markdown-preview-body :deep(p) {
  margin: 0.55rem 0;
}

.artifact-markdown-preview-body :deep(code) {
  border-radius: 0.35rem;
  background: var(--artifact-summary-code-bg);
  padding: 0.08rem 0.28rem;
  font-size: 0.95em;
}

.artifact-summary-finish {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.85rem;
  font-size: 0.96rem;
  font-weight: 700;
  color: #4ade80;
}

@media (max-width: 768px) {
  .artifact-summary-cards {
    gap: 0.75rem;
  }

  .artifact-summary-card {
    width: 100%;
    min-height: 5rem;
    padding: 0.9rem 1rem;
  }

  .artifact-markdown-preview-card {
    width: 100%;
  }

  .artifact-markdown-preview-body {
    padding: 1rem 1.1rem 2rem;
  }
}

@keyframes tool-card-shimmer {
  0% {
    transform: translateX(-130%);
  }

  100% {
    transform: translateX(140%);
  }
}

@keyframes tool-status-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 0 rgba(59, 130, 246, 0.32),
      0 0 14px rgba(56, 189, 248, 0.34);
  }

  50% {
    box-shadow:
      0 0 0 6px rgba(59, 130, 246, 0),
      0 0 20px rgba(56, 189, 248, 0.5);
  }
}
</style>
