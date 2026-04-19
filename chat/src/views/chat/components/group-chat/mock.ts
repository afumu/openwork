import type {
  DiscussionMessage,
  DiscussionParticipant,
  DiscussionRoom,
  ExpertCandidate,
  ResponseLength,
} from './types'
import { createId } from './utils'

interface ExpertSeed {
  name: string
  identity: string
  organization: string
  expertise: string[]
  perspective: string
  stance: string
  prominenceScore: number
  professionalScore: number
  evidenceScore: number
  tier: '临时专家' | '可复用专家' | '优选专家'
  topicTags: string[]
}

const expertSeeds: ExpertSeed[] = [
  {
    name: 'Sam Altman',
    identity: 'OpenAI CEO',
    organization: 'OpenAI',
    expertise: ['大模型产品', '商业化', '平台战略'],
    perspective: '技术 / 产品',
    stance: '乐观推动',
    prominenceScore: 98,
    professionalScore: 94,
    evidenceScore: 96,
    tier: '优选专家',
    topicTags: ['openai', 'ai', '收购', '平台', '模型', '产业'],
  },
  {
    name: 'Demis Hassabis',
    identity: 'Google DeepMind CEO',
    organization: 'Google DeepMind',
    expertise: ['研究路线', '模型能力', '科学发现'],
    perspective: '学术 / 研究',
    stance: '审慎中立',
    prominenceScore: 95,
    professionalScore: 97,
    evidenceScore: 95,
    tier: '优选专家',
    topicTags: ['研究', '模型', 'ai', '长期', '科学'],
  },
  {
    name: '李飞飞',
    identity: '斯坦福大学教授',
    organization: 'Stanford HAI',
    expertise: ['AI 教育', '人本 AI', '学术研究'],
    perspective: '学术 / 研究',
    stance: '审慎中立',
    prominenceScore: 96,
    professionalScore: 96,
    evidenceScore: 94,
    tier: '优选专家',
    topicTags: ['教育', '治理', '研究', '人才', '长期', 'ai'],
  },
  {
    name: 'Andrew Ng',
    identity: 'DeepLearning.AI 创始人',
    organization: 'DeepLearning.AI',
    expertise: ['AI 应用', '教育培训', '企业落地'],
    perspective: '产业 / 应用',
    stance: '乐观推动',
    prominenceScore: 94,
    professionalScore: 95,
    evidenceScore: 92,
    tier: '优选专家',
    topicTags: ['教育', '产业', '企业', '落地', 'ai'],
  },
  {
    name: 'Ethan Mollick',
    identity: '沃顿商学院教授',
    organization: 'Wharton',
    expertise: ['教育实验', '知识工作', '组织变革'],
    perspective: '学术 / 研究',
    stance: '乐观推动',
    prominenceScore: 88,
    professionalScore: 91,
    evidenceScore: 89,
    tier: '可复用专家',
    topicTags: ['教育', '组织', '办公', '效率', '长期', 'ai'],
  },
  {
    name: 'Geoffrey Hinton',
    identity: '图灵奖得主',
    organization: 'University of Toronto',
    expertise: ['神经网络', 'AI 风险', '研究方向'],
    perspective: '学术 / 研究',
    stance: '批判质疑',
    prominenceScore: 93,
    professionalScore: 98,
    evidenceScore: 94,
    tier: '优选专家',
    topicTags: ['风险', '治理', 'ai', '研究', '长期'],
  },
  {
    name: 'Satya Nadella',
    identity: 'Microsoft CEO',
    organization: 'Microsoft',
    expertise: ['平台协同', '企业软件', '生态战略'],
    perspective: '投资 / 商业',
    stance: '乐观推动',
    prominenceScore: 97,
    professionalScore: 92,
    evidenceScore: 93,
    tier: '优选专家',
    topicTags: ['openai', '收购', '平台', '商业', '生态', '企业'],
  },
  {
    name: 'Jensen Huang',
    identity: 'NVIDIA CEO',
    organization: 'NVIDIA',
    expertise: ['算力供给', '产业基础设施', '芯片生态'],
    perspective: '产业 / 应用',
    stance: '乐观推动',
    prominenceScore: 96,
    professionalScore: 93,
    evidenceScore: 93,
    tier: '优选专家',
    topicTags: ['产业', '算力', '芯片', '基础设施', 'ai'],
  },
  {
    name: 'Ben Thompson',
    identity: '科技分析师',
    organization: 'Stratechery',
    expertise: ['平台战略', '并购分析', '商业评论'],
    perspective: '投资 / 商业',
    stance: '审慎中立',
    prominenceScore: 84,
    professionalScore: 88,
    evidenceScore: 87,
    tier: '可复用专家',
    topicTags: ['收购', '平台', '商业', '产业', '竞争'],
  },
  {
    name: 'Kai-Fu Lee',
    identity: '创新工场董事长',
    organization: 'Sinovation Ventures',
    expertise: ['AI 创业', '中国市场', '产业应用'],
    perspective: '投资 / 商业',
    stance: '乐观推动',
    prominenceScore: 90,
    professionalScore: 88,
    evidenceScore: 86,
    tier: '可复用专家',
    topicTags: ['创业', '中国', '商业', '教育', '产业', 'ai'],
  },
  {
    name: 'Audrey Tang',
    identity: '前台湾数位发展主管部门负责人',
    organization: 'g0v',
    expertise: ['公共治理', '数字民主', 'AI 治理'],
    perspective: '政策 / 治理',
    stance: '审慎中立',
    prominenceScore: 83,
    professionalScore: 86,
    evidenceScore: 84,
    tier: '可复用专家',
    topicTags: ['治理', '政策', '教育', '公共部门', 'ai'],
  },
  {
    name: 'Meredith Whittaker',
    identity: 'Signal 总裁',
    organization: 'Signal',
    expertise: ['隐私', 'AI 治理', '平台权力'],
    perspective: '政策 / 治理',
    stance: '批判质疑',
    prominenceScore: 80,
    professionalScore: 86,
    evidenceScore: 84,
    tier: '可复用专家',
    topicTags: ['治理', '隐私', '风险', '平台', 'ai'],
  },
  {
    name: 'Sal Khan',
    identity: 'Khan Academy 创始人',
    organization: 'Khan Academy',
    expertise: ['教育产品', '学习体验', '个性化辅导'],
    perspective: '产业 / 应用',
    stance: '乐观推动',
    prominenceScore: 82,
    professionalScore: 87,
    evidenceScore: 85,
    tier: '可复用专家',
    topicTags: ['教育', '学习', '产品', '长期', 'ai'],
  },
  {
    name: 'Dario Amodei',
    identity: 'Anthropic CEO',
    organization: 'Anthropic',
    expertise: ['模型安全', 'AI 能力边界', '商业竞争'],
    perspective: '技术 / 产品',
    stance: '审慎中立',
    prominenceScore: 90,
    professionalScore: 93,
    evidenceScore: 91,
    tier: '优选专家',
    topicTags: ['安全', '模型', '竞争', 'ai', '平台'],
  },
  {
    name: 'Margrethe Vestager',
    identity: '欧盟前执行副主席',
    organization: 'European Commission',
    expertise: ['竞争监管', '平台治理', '政策约束'],
    perspective: '政策 / 治理',
    stance: '批判质疑',
    prominenceScore: 82,
    professionalScore: 84,
    evidenceScore: 83,
    tier: '可复用专家',
    topicTags: ['收购', '治理', '监管', '平台', '竞争'],
  },
]

function getTopicKeywords(topic: string) {
  return topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function pickEvidenceLabel(score: number) {
  if (score >= 93) return '资料充分'
  if (score >= 86) return '资料较充分'
  return '资料有限'
}

function buildRecommendationReason(topic: string, expert: ExpertSeed) {
  const focus = expert.expertise.slice(0, 2).join('、')
  return `围绕“${topic}”，${expert.name}在${focus}上具备公开表达与长期观察，适合提供${expert.perspective}视角下的${expert.stance}判断。`
}

function buildPersonaPromptBase(seed: {
  name: string
  identity: string
  organization: string
  perspective: string
  stance: string
  expertise: string[]
  isManual?: boolean
}) {
  const manualHint = seed.isManual
    ? '公开资料有限时要主动承认不确定性，避免强行下结论。'
    : '优先依据公开资料中的稳定观点发言，不冒充真人原话。'

  return [
    `你现在扮演专家代理 ${seed.name}。`,
    `身份背景：${seed.identity}，所属机构：${seed.organization}。`,
    `讨论视角：${seed.perspective}；立场倾向：${seed.stance}。`,
    `优先关注：${seed.expertise.join('、')}。`,
    '输出语言固定为中文，风格介于专业圆桌评论与真实群聊之间。',
    '允许自主决定是否搜索公开资料，并向用户显露轻量过程状态。',
    manualHint,
  ].join('\n')
}

export function regeneratePersonaPrompt(input: {
  name: string
  identity: string
  organization: string
  perspective: string
  stance: string
  expertise: string[]
  topic: string
  goal?: string
  extraNeed?: string
  isManual?: boolean
}) {
  const goalLine = input.goal ? `本场目标：${input.goal}。` : '本场目标：把核心分歧讲透。'
  const extraLine = input.extraNeed?.trim()
    ? `额外要求：${input.extraNeed.trim()}。请把这条要求体现在发言偏好与论证方式里。`
    : '额外要求：如果讨论跑偏，请主动把论点拉回当前主题。'

  return `${buildPersonaPromptBase(input)}\n当前主题：${input.topic}。\n${goalLine}\n${extraLine}`
}

function pickRecommendedIds(candidates: ExpertCandidate[]) {
  const selected: ExpertCandidate[] = []
  const usedPerspectives = new Set<string>()
  const usedStances = new Set<string>()

  for (const candidate of candidates) {
    if (!usedPerspectives.has(candidate.perspective) || !usedStances.has(candidate.stance)) {
      selected.push(candidate)
      usedPerspectives.add(candidate.perspective)
      usedStances.add(candidate.stance)
    }

    if (selected.length === 5) break
  }

  for (const candidate of candidates) {
    if (selected.length === 5) break
    if (!selected.some(item => item.id === candidate.id)) {
      selected.push(candidate)
    }
  }

  return selected.map(item => item.id)
}

export function discoverExperts(topic: string) {
  const keywords = getTopicKeywords(topic)

  const ranked = expertSeeds
    .map(seed => {
      const matchScore = seed.topicTags.reduce((score, tag) => {
        if (topic.includes(tag)) return score + 8
        if (keywords.some(keyword => tag.includes(keyword) || keyword.includes(tag))) {
          return score + 5
        }
        return score
      }, 0)

      const totalScore = matchScore + seed.prominenceScore * 0.55 + seed.professionalScore * 0.45
      return { seed, totalScore }
    })
    .sort((left, right) => right.totalScore - left.totalScore)
    .slice(0, 10)
    .map(({ seed }) => ({
      id: createId('expert'),
      name: seed.name,
      identity: seed.identity,
      organization: seed.organization,
      expertise: seed.expertise,
      perspective: seed.perspective,
      stance: seed.stance,
      recommendationReason: buildRecommendationReason(topic, seed),
      evidenceLabel: pickEvidenceLabel(seed.evidenceScore),
      evidenceScore: seed.evidenceScore,
      prominenceScore: seed.prominenceScore,
      professionalScore: seed.professionalScore,
      tier: seed.tier,
      recommended: false,
      topicTags: seed.topicTags,
      personaPrompt: regeneratePersonaPrompt({
        ...seed,
        topic,
      }),
    }))

  const recommendedIds = pickRecommendedIds(ranked)
  return ranked.map(candidate => ({
    ...candidate,
    recommended: recommendedIds.includes(candidate.id),
  }))
}

export function createManualExpert(topic: string, name: string): ExpertCandidate {
  const manualExpert: ExpertCandidate = {
    id: createId('manual-expert'),
    name,
    identity: '手动追加真实专家',
    organization: '待补充公开资料',
    expertise: ['主题相关观察'],
    perspective: '待确认',
    stance: '审慎中立',
    recommendationReason: `用户主动指定 ${name} 参与“${topic}”讨论，系统允许加入并在后续轮次补充资料。`,
    evidenceLabel: '资料有限',
    evidenceScore: 62,
    prominenceScore: 70,
    professionalScore: 68,
    tier: '临时专家',
    recommended: true,
    isManual: true,
    topicTags: [],
    personaPrompt: regeneratePersonaPrompt({
      name,
      identity: '手动追加真实专家',
      organization: '待补充公开资料',
      expertise: ['主题相关观察'],
      perspective: '待确认',
      stance: '审慎中立',
      topic,
      isManual: true,
    }),
  }

  return manualExpert
}

export function createParticipants(selectedExperts: ExpertCandidate[]) {
  const host: DiscussionParticipant = {
    id: 'host',
    participantType: 'host',
    displayName: '群主',
    roleSummary: '主持型 agent · 苏格拉底式追问',
    organization: 'OpenWork Discussion Host',
    joinRound: 0,
    personaPrompt:
      '你是群主，负责控场、追问、点名和收束。优先放大高价值分歧，让用户感到讨论在往更清晰的方向推进。',
  }

  const user: DiscussionParticipant = {
    id: 'user',
    participantType: 'user',
    displayName: '你',
    roleSummary: '发起人',
    joinRound: 0,
  }

  const experts: DiscussionParticipant[] = selectedExperts.map(expert => ({
    id: expert.id,
    participantType: 'expert',
    displayName: expert.name,
    roleSummary: `${expert.identity} · ${expert.organization}`,
    organization: expert.organization,
    perspective: expert.perspective,
    stance: expert.stance,
    joinRound: 1,
    isManual: expert.isManual,
    personaPrompt: expert.personaPrompt,
  }))

  return [host, ...experts, user]
}

function buildStatusItems(length: ResponseLength) {
  const sourceCount = 3 + Math.floor(Math.random() * 4)
  const tone = length === 'brief' ? '短答模式' : length === 'deep' ? '深入展开' : '标准展开'
  return ['正在搜索', `找到 ${sourceCount} 条来源`, `${tone} · 正在整理回应`]
}

function getResponderPair(room: DiscussionRoom, prompt?: string) {
  const experts = room.participants.filter(item => item.participantType === 'expert')
  const mentions = experts.filter(item => prompt?.includes(`@${item.displayName}`))
  const leadExpert = mentions[0] || experts[room.currentRound % Math.max(experts.length, 1)]
  const counterExpert =
    experts.find(item => item.id !== leadExpert?.id && item.stance !== leadExpert?.stance) ||
    experts.find(item => item.id !== leadExpert?.id)

  return { leadExpert, counterExpert }
}

function buildHostOpening(room: DiscussionRoom) {
  const expertNames = room.participants
    .filter(item => item.participantType === 'expert')
    .slice(0, 3)
    .map(item => item.displayName)
    .join('、')

  return `今天我们围绕“${room.topic}”展开真实专家代理群聊，目标是${room.goal || '把核心分歧讲透'}。我会优先放大真正有价值的分歧，不追求立刻达成一致。先请 ${expertNames} 依次给出判断框架。`
}

function buildHostSteering(
  round: number,
  leadExpert: DiscussionParticipant,
  counterExpert?: DiscussionParticipant,
  userPrompt?: string
) {
  if (userPrompt) {
    return `我收到你的新问题了。第 ${round} 轮我先请 ${leadExpert.displayName} 正面回应，再请 ${counterExpert?.displayName || '另一位不同立场专家'} 补上反驳或边界条件，尽量把争议点缩到最关键的一层。`
  }

  return `进入第 ${round} 轮。我先请 ${leadExpert.displayName} 往前推进论点，再请 ${counterExpert?.displayName || '另一位专家'} 从不同立场补充，看看真正的分歧是在时间尺度、资源约束，还是执行路径。`
}

function getPersonaAccent(personaPrompt?: string) {
  if (!personaPrompt) return ''
  const lines = personaPrompt.split('\n')
  const extraLine = lines.find(line => line.startsWith('额外要求：'))
  if (extraLine) {
    return extraLine
      .replace('额外要求：', '')
      .replace('。请把这条要求体现在发言偏好与论证方式里。', '')
  }
  return lines[lines.length - 1] || ''
}

function buildLengthTail(length: ResponseLength) {
  if (length === 'brief') {
    return '如果只保留一句判断，我会先抓住最关键的结论。'
  }

  if (length === 'deep') {
    return '如果继续深挖，我会把短期信号、结构变量和长期外溢影响拆开看，再判断哪些因素真正可持续。'
  }

  return '如果要继续讨论，我建议顺着最核心的变量再拆一层，不要被表层情绪牵着走。'
}

function buildExpertResponse(
  room: DiscussionRoom,
  expert: DiscussionParticipant,
  prompt?: string,
  isCounterpoint?: boolean
) {
  const topic = room.topic
  const contextText = room.topicContext ? `结合你补充的“${room.topicContext}”，` : ''
  const promptText = prompt ? `如果直接回应“${prompt}”，` : ''
  const personaAccent = getPersonaAccent(expert.personaPrompt)
  const accentText = personaAccent ? `另外，我会特别按“${personaAccent}”这个要求来组织论证。` : ''
  const lengthTail = buildLengthTail(room.responseLength)

  if (expert.perspective === '政策 / 治理') {
    return `${contextText}${promptText}我会先看制度与激励是否匹配。围绕“${topic}”，真正决定长期结果的往往不是短期热度，而是平台权力如何分配、责任如何追踪，以及谁来承担外部性。${
      isCounterpoint
        ? '如果前面观点过于乐观，我会提醒监管与社会信任的滞后成本。'
        : '所以我更关心规则能否跟上，而不只是产品能否跑得更快。'
    }${accentText}${lengthTail}`
  }

  if (expert.perspective === '投资 / 商业') {
    return `${contextText}${promptText}从商业结构看，“${topic}”不是单点事件，而是价值链重分配。短期看流量和估值，长期看谁拿到分发入口、数据回流与议价权。${
      isCounterpoint
        ? '我会追问这件事是不是被市场叙事高估了。'
        : '如果没有持续性的组织与渠道优势，热点很快会回落。'
    }${accentText}${lengthTail}`
  }

  if (expert.perspective === '学术 / 研究') {
    return `${contextText}${promptText}我倾向把“${topic}”拆成能力边界、评估方式与长期影响三个问题。短期样本容易让人高估趋势，但真正重要的是这种变化是否可重复、是否能迁移，以及它会不会改变人的学习与判断结构。${accentText}${lengthTail}`
  }

  if (expert.perspective === '产业 / 应用') {
    return `${contextText}${promptText}站在应用落地视角，我最关心的是“${topic}”能不能进入真实流程。只要它不能稳定嵌入组织协作、成本结构和现有工具链，讨论就会停留在演示层。${
      isCounterpoint
        ? '所以我会对过早放大的叙事保持克制。'
        : '一旦流程被重写，影响通常会比单点功能升级更深。'
    }${accentText}${lengthTail}`
  }

  return `${contextText}${promptText}从技术与产品视角看，“${topic}”的关键不是表面事件，而是它是否改变了能力供给与用户预期的组合。我的判断是，这件事既会放大头部平台优势，也会逼着所有参与者重新定义自己的位置。${accentText}${lengthTail}`
}

function buildSummary(room: DiscussionRoom) {
  const tension = room.participants
    .filter(item => item.participantType === 'expert')
    .slice(0, 2)
    .map(item => item.displayName)
    .join(' 与 ')

  return `今天先收束到这里。围绕“${room.topic}”，最有价值的分歧主要集中在三点：一是短期叙事与长期结构变化是否一致，二是平台控制力与公共治理谁更应先行，三是落地成本究竟会被技术进步抵消还是放大。${tension} 代表了本场最清晰的两条判断路径，后续如果你愿意，我们可以继续沿着其中一条子问题深入。`
}

export function createInitialMessages(room: DiscussionRoom) {
  const experts = room.participants.filter(item => item.participantType === 'expert')
  const firstExpert = experts[0]
  const secondExpert = experts.find(item => item.stance !== firstExpert?.stance) || experts[1]
  const now = new Date().toISOString()

  const messages: DiscussionMessage[] = [
    {
      id: createId('msg'),
      participantId: 'host',
      participantType: 'host',
      messageType: 'host_opening',
      content: buildHostOpening(room),
      createdAt: now,
      roundIndex: 1,
      displayName: '群主',
      roleSummary: '主持型 agent · 苏格拉底式追问',
    },
  ]

  if (firstExpert) {
    messages.push({
      id: createId('msg'),
      participantId: firstExpert.id,
      participantType: 'expert',
      messageType: 'expert_message',
      content: buildExpertResponse(room, firstExpert),
      createdAt: now,
      roundIndex: 1,
      displayName: firstExpert.displayName,
      roleSummary: firstExpert.roleSummary,
      perspective: firstExpert.perspective,
      stance: firstExpert.stance,
      statusItems: buildStatusItems(room.responseLength),
    })
  }

  if (secondExpert) {
    messages.push({
      id: createId('msg'),
      participantId: secondExpert.id,
      participantType: 'expert',
      messageType: 'expert_message',
      content: buildExpertResponse(room, secondExpert, undefined, true),
      createdAt: now,
      roundIndex: 1,
      displayName: secondExpert.displayName,
      roleSummary: secondExpert.roleSummary,
      perspective: secondExpert.perspective,
      stance: secondExpert.stance,
      statusItems: buildStatusItems(room.responseLength),
    })
  }

  return messages
}

export function planLiveResponders(room: DiscussionRoom, prompt?: string) {
  const { leadExpert, counterExpert } = getResponderPair(room, prompt)
  const responders: DiscussionRoom['liveResponders'] = [
    {
      participantId: 'host',
      displayName: '群主',
      phase: 'synthesizing',
    },
  ]

  if (leadExpert) {
    responders.push({
      participantId: leadExpert.id,
      displayName: leadExpert.displayName,
      phase: 'searching',
    })
  }

  if (counterExpert) {
    responders.push({
      participantId: counterExpert.id,
      displayName: counterExpert.displayName,
      phase: 'replying',
    })
  }

  return responders
}

export function appendDiscussionRound(room: DiscussionRoom, prompt?: string) {
  const { leadExpert, counterExpert } = getResponderPair(room, prompt)
  const nextRound = room.currentRound + 1
  const now = new Date().toISOString()

  const additions: DiscussionMessage[] = [
    {
      id: createId('msg'),
      participantId: 'host',
      participantType: 'host',
      messageType: 'host_opening',
      content: buildHostSteering(nextRound, leadExpert, counterExpert, prompt),
      createdAt: now,
      roundIndex: nextRound,
      displayName: '群主',
      roleSummary: '主持型 agent · 苏格拉底式追问',
      targetParticipantIds: [leadExpert?.id, counterExpert?.id].filter(Boolean) as string[],
    },
  ]

  if (leadExpert) {
    additions.push({
      id: createId('msg'),
      participantId: leadExpert.id,
      participantType: 'expert',
      messageType: 'expert_message',
      content: buildExpertResponse(room, leadExpert, prompt),
      createdAt: now,
      roundIndex: nextRound,
      displayName: leadExpert.displayName,
      roleSummary: leadExpert.roleSummary,
      perspective: leadExpert.perspective,
      stance: leadExpert.stance,
      statusItems: buildStatusItems(room.responseLength),
    })
  }

  if (counterExpert) {
    additions.push({
      id: createId('msg'),
      participantId: counterExpert.id,
      participantType: 'expert',
      messageType: 'expert_message',
      content: buildExpertResponse(room, counterExpert, prompt, true),
      createdAt: now,
      roundIndex: nextRound,
      displayName: counterExpert.displayName,
      roleSummary: counterExpert.roleSummary,
      perspective: counterExpert.perspective,
      stance: counterExpert.stance,
      statusItems: buildStatusItems(room.responseLength),
    })
  }

  return {
    nextRound,
    messages: additions,
  }
}

export function createJoinNotice(
  participant: DiscussionParticipant,
  roundIndex: number
): DiscussionMessage {
  return {
    id: createId('msg'),
    participantId: participant.id,
    participantType: 'expert',
    messageType: 'expert_join_notice',
    content: `${participant.displayName} 已加入房间，系统已同步当前讨论摘要。${
      participant.isManual ? '资料有限，观点稳定性较弱。' : '后续将从下一轮开始参与。'
    }`,
    createdAt: new Date().toISOString(),
    roundIndex,
    displayName: participant.displayName,
    roleSummary: participant.roleSummary,
    perspective: participant.perspective,
    stance: participant.stance,
  }
}

export function createSummaryMessage(room: DiscussionRoom): DiscussionMessage {
  return {
    id: createId('msg'),
    participantId: 'host',
    participantType: 'host',
    messageType: 'discussion_summary',
    content: buildSummary(room),
    createdAt: new Date().toISOString(),
    roundIndex: room.currentRound,
    displayName: '群主',
    roleSummary: '主持型 agent · 苏格拉底式追问',
  }
}
