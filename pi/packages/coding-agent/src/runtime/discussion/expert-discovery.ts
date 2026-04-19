import { randomUUID } from "node:crypto";
import type { WebSearchResultItem } from "../web-search-tool.js";
import type {
	DiscussionDiscoveryRequest,
	DiscussionDiscoveryResult,
	DiscussionExpertCandidate,
	DiscussionParticipantPerspective,
	DiscussionParticipantStance,
	DiscussionParticipantTier,
} from "./types.js";

export interface DiscussionExpertDiscoveryDependencies {
	search: (query: string, limit: number, signal?: AbortSignal) => Promise<WebSearchResultItem[]>;
	generateText: (input: { systemPrompt: string; userPrompt: string; signal?: AbortSignal }) => Promise<string>;
}

type SeedExpert = {
	name: string;
	identity: string;
	organization: string;
	expertise: string[];
	perspective: DiscussionParticipantPerspective;
	stance: DiscussionParticipantStance;
	prominenceScore: number;
	professionalScore: number;
	evidenceScore: number;
	tier: DiscussionParticipantTier;
	topicTags: string[];
};

const expertSeeds: SeedExpert[] = [
	{
		name: "Sam Altman",
		identity: "OpenAI CEO",
		organization: "OpenAI",
		expertise: ["AI 平台", "资本开支", "技术产业"],
		perspective: "技术 / 产品",
		stance: "审慎中立",
		prominenceScore: 98,
		professionalScore: 94,
		evidenceScore: 94,
		tier: "优选专家",
		topicTags: ["ai", "平台", "资本", "科技"],
	},
	{
		name: "Jensen Huang",
		identity: "NVIDIA CEO",
		organization: "NVIDIA",
		expertise: ["算力基础设施", "资本开支", "产业链"],
		perspective: "产业 / 应用",
		stance: "乐观推动",
		prominenceScore: 97,
		professionalScore: 94,
		evidenceScore: 92,
		tier: "优选专家",
		topicTags: ["算力", "资本", "芯片", "ai"],
	},
	{
		name: "Ray Dalio",
		identity: "Bridgewater Associates 创始人",
		organization: "Bridgewater Associates",
		expertise: ["宏观经济", "地缘政治", "全球市场"],
		perspective: "投资 / 商业",
		stance: "审慎中立",
		prominenceScore: 95,
		professionalScore: 93,
		evidenceScore: 92,
		tier: "优选专家",
		topicTags: ["战争", "资本市场", "宏观", "地缘政治"],
	},
	{
		name: "Geoffrey Hinton",
		identity: "图灵奖得主",
		organization: "University of Toronto",
		expertise: ["AI 风险", "研究趋势", "模型能力"],
		perspective: "学术 / 研究",
		stance: "批判质疑",
		prominenceScore: 95,
		professionalScore: 98,
		evidenceScore: 90,
		tier: "优选专家",
		topicTags: ["ai", "风险", "研究"],
	},
	{
		name: "李飞飞",
		identity: "斯坦福大学教授",
		organization: "Stanford HAI",
		expertise: ["AI 治理", "学术研究", "人本 AI"],
		perspective: "学术 / 研究",
		stance: "审慎中立",
		prominenceScore: 96,
		professionalScore: 96,
		evidenceScore: 92,
		tier: "优选专家",
		topicTags: ["ai", "治理", "教育", "研究"],
	},
	{
		name: "Satya Nadella",
		identity: "Microsoft CEO",
		organization: "Microsoft",
		expertise: ["企业软件", "平台战略", "资本配置"],
		perspective: "投资 / 商业",
		stance: "乐观推动",
		prominenceScore: 97,
		professionalScore: 92,
		evidenceScore: 91,
		tier: "优选专家",
		topicTags: ["平台", "资本", "企业", "ai"],
	},
	{
		name: "Ben Thompson",
		identity: "科技分析师",
		organization: "Stratechery",
		expertise: ["平台竞争", "商业分析", "行业结构"],
		perspective: "投资 / 商业",
		stance: "审慎中立",
		prominenceScore: 84,
		professionalScore: 88,
		evidenceScore: 86,
		tier: "可复用专家",
		topicTags: ["平台", "竞争", "科技"],
	},
	{
		name: "Kai-Fu Lee",
		identity: "创新工场董事长",
		organization: "Sinovation Ventures",
		expertise: ["中国市场", "AI 产业", "投资逻辑"],
		perspective: "投资 / 商业",
		stance: "乐观推动",
		prominenceScore: 90,
		professionalScore: 88,
		evidenceScore: 85,
		tier: "可复用专家",
		topicTags: ["中国", "ai", "投资", "产业"],
	},
	{
		name: "Mohamed El-Erian",
		identity: "经济学家、市场策略师",
		organization: "Queens' College Cambridge / Allianz",
		expertise: ["宏观市场", "利率周期", "风险资产"],
		perspective: "投资 / 商业",
		stance: "审慎中立",
		prominenceScore: 90,
		professionalScore: 91,
		evidenceScore: 88,
		tier: "可复用专家",
		topicTags: ["资本市场", "宏观", "利率", "风险"],
	},
	{
		name: "Ian Bremmer",
		identity: "政治风险分析师",
		organization: "Eurasia Group",
		expertise: ["地缘政治", "政策风险", "全球秩序"],
		perspective: "政策 / 治理",
		stance: "批判质疑",
		prominenceScore: 88,
		professionalScore: 89,
		evidenceScore: 86,
		tier: "可复用专家",
		topicTags: ["战争", "地缘政治", "政策", "风险"],
	},
];

export function discoverDiscussionExperts(request: DiscussionDiscoveryRequest): DiscussionDiscoveryResult {
	const topic = request.topic?.trim();
	if (!topic) {
		return {
			candidates: [],
			meta: {
				queries: [],
				resultCount: 0,
				extractionMode: "empty",
			},
		};
	}

	const topicTags = buildFallbackTopicTags(topic);
	const candidates = expertSeeds
		.map((seed) => ({
			...seed,
			total: scoreSeedExpert(seed, topicTags),
		}))
		.sort((left, right) => right.total - left.total)
		.slice(0, normalizeFallbackLimit(request.limit, 10))
		.map((seed, index) => ({
			id: `runtime-expert-${index + 1}`,
			name: seed.name,
			identity: seed.identity,
			organization: seed.organization,
			expertise: seed.expertise,
			perspective: seed.perspective,
			stance: seed.stance,
			recommendationReason: `基于“${topic}”的专业相关性、知名度和观点差异度，建议引入 ${seed.name} 提供 ${seed.perspective} 视角。`,
			evidenceLabel: pickFallbackEvidenceLabel(seed.evidenceScore),
			evidenceScore: seed.evidenceScore,
			prominenceScore: seed.prominenceScore,
			professionalScore: seed.professionalScore,
			tier: seed.tier,
			recommended: index < 5,
			topicTags,
			personaPrompt: buildFallbackPersonaPrompt(seed, topic),
		}));

	return {
		candidates,
		meta: {
			queries: [`${topic} 专家 观点 分析`, `${topic} analysts experts commentary`, `${topic} 学者 投资人 CEO`],
			resultCount: candidates.length,
			extractionMode: "runtime_agent",
		},
	};
}

function scoreSeedExpert(seed: SeedExpert, topicTags: string[]) {
	const tagScore = seed.topicTags.reduce((score, tag) => {
		if (topicTags.some((topicTag) => tag.includes(topicTag) || topicTag.includes(tag))) {
			return score + 8;
		}
		return score;
	}, 0);
	return seed.prominenceScore * 0.5 + seed.professionalScore * 0.45 + seed.evidenceScore * 0.05 + tagScore;
}

function buildFallbackPersonaPrompt(seed: SeedExpert, topic: string) {
	return [
		`你现在扮演专家代理 ${seed.name}。`,
		`身份背景：${seed.identity}，所属机构：${seed.organization}。`,
		`讨论视角：${seed.perspective}；立场倾向：${seed.stance}。`,
		`优先关注：${seed.expertise.join("、")}。`,
		`当前主题：${topic}。`,
		"输出语言固定为中文，风格介于专业圆桌评论与真实群聊之间。",
		"你可以根据讨论需要自主决定是否搜索公开资料，并向用户显露轻量过程状态。",
	].join("\n");
}

function buildFallbackTopicTags(topic: string) {
	return topic
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 8);
}

function normalizeFallbackLimit(value: number | undefined, fallback: number) {
	const limit = Number(value || fallback);
	if (!Number.isFinite(limit)) {
		return fallback;
	}
	return Math.max(1, Math.min(Math.floor(limit), 10));
}

function pickFallbackEvidenceLabel(score: number) {
	if (score >= 93) return "资料充分";
	if (score >= 86) return "资料较充分";
	return "资料有限";
}

export class DiscussionExpertDiscovery {
	constructor(private readonly dependencies: DiscussionExpertDiscoveryDependencies) {}

	async discoverExperts(
		request: DiscussionDiscoveryRequest,
		signal?: AbortSignal,
	): Promise<DiscussionDiscoveryResult> {
		const normalizedTopic = request.topic?.trim();
		if (!normalizedTopic) {
			return {
				candidates: [],
				meta: {
					queries: [],
					resultCount: 0,
					extractionMode: "empty",
				},
			};
		}

		const { queries, searchResults } = await this.fetchSearchResults(normalizedTopic, signal);
		if (!searchResults.length) {
			return {
				candidates: [],
				meta: {
					queries,
					resultCount: 0,
					extractionMode: "empty",
				},
			};
		}

		const modelCandidates = await this.extractExpertsWithModel(normalizedTopic, searchResults, signal);
		if (modelCandidates.length > 0) {
			return {
				candidates: this.markRecommended(modelCandidates).slice(0, this.normalizeLimit(request.limit, 10)),
				meta: {
					queries,
					resultCount: searchResults.length,
					extractionMode: "model",
				},
			};
		}

		return {
			candidates: this.rankSeedExperts(normalizedTopic, searchResults).slice(
				0,
				this.normalizeLimit(request.limit, 10),
			),
			meta: {
				queries,
				resultCount: searchResults.length,
				extractionMode: "fallback",
			},
		};
	}

	private async fetchSearchResults(
		topic: string,
		signal?: AbortSignal,
	): Promise<{ queries: string[]; searchResults: WebSearchResultItem[] }> {
		const queries = [`${topic} 专家 观点 分析`, `${topic} analysts experts commentary`, `${topic} 学者 投资人 CEO`];

		const collected: WebSearchResultItem[] = [];
		const seen = new Set<string>();

		for (const query of queries) {
			try {
				const searchResults = await this.dependencies.search(query, 12, signal);
				for (const item of searchResults || []) {
					const key = String(item?.link || item?.title || "");
					if (!key || seen.has(key)) {
						continue;
					}
					seen.add(key);
					collected.push({
						title: item.title,
						link: item.link,
						content: item.content,
						media: item.media,
						time: item.time,
					});
				}
			} catch (_error) {
				// Keep collecting from remaining queries.
			}
		}

		return {
			queries,
			searchResults: collected.slice(0, 20),
		};
	}

	private async extractExpertsWithModel(
		topic: string,
		searchResults: WebSearchResultItem[],
		signal?: AbortSignal,
	): Promise<DiscussionExpertCandidate[]> {
		const systemPrompt = [
			"你是一个真实人物专家发现器。",
			"你会基于最新网络搜索结果，为一个主题挑选真实的专家候选人。",
			"只返回 JSON 数组，不要输出 markdown，不要输出解释。",
			"每个对象必须包含这些字段：",
			"name, identity, organization, expertise, perspective, stance, recommendationReason, evidenceLabel, evidenceScore, prominenceScore, professionalScore, tier, recommended, topicTags, personaPrompt",
			"要求：",
			"1. 必须是真实世界中的人物。",
			"2. 优先选择与主题直接相关、且公开资料较充分的人物。",
			"3. 要覆盖不同专业视角和不同立场倾向。",
			"4. perspective 只能使用：技术 / 产品、学术 / 研究、投资 / 商业、产业 / 应用、政策 / 治理。",
			"5. stance 只能使用：乐观推动、审慎中立、批判质疑。",
			"6. tier 只能使用：临时专家、可复用专家、优选专家。",
			"7. expertise 和 topicTags 必须是字符串数组。",
			"8. personaPrompt 必须是中文，且以“你现在扮演专家代理”开头。",
			"9. 返回 6 到 10 个对象。",
		].join("\n");

		const prompt = [
			`当前主题：${topic}`,
			"以下是联网搜索结果，请从中找出适合进入讨论房间的真实专家：",
			JSON.stringify(
				searchResults.map((item) => ({
					title: item.title,
					source: item.media,
					url: item.link,
					content: item.content,
				})),
				null,
				2,
			),
		].join("\n\n");

		try {
			const response = await this.dependencies.generateText({
				systemPrompt,
				userPrompt: prompt,
				signal,
			});
			return this.parseModelCandidates(response, topic);
		} catch {
			return [];
		}
	}

	private parseModelCandidates(raw: string | undefined, topic: string): DiscussionExpertCandidate[] {
		if (!raw) {
			return [];
		}

		const jsonText = this.extractJsonText(raw);
		if (!jsonText) {
			return [];
		}

		try {
			const parsed = JSON.parse(jsonText);
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed
				.filter((item) => item && typeof item === "object" && "name" in item)
				.map((item, index) => this.normalizeCandidate(item as Record<string, unknown>, topic, `live-${index + 1}`))
				.slice(0, 10);
		} catch {
			return [];
		}
	}

	private normalizeCandidate(
		item: Record<string, unknown>,
		topic: string,
		fallbackId: string,
	): DiscussionExpertCandidate {
		const evidenceScore = this.normalizeScore(item.evidenceScore, 84);
		return {
			id: String(item.id || `expert-${fallbackId || randomUUID()}`),
			name: String(item.name || "未知专家"),
			identity: String(item.identity || "公开身份待补充"),
			organization: String(item.organization || "公开机构待补充"),
			expertise: Array.isArray(item.expertise) ? item.expertise.map((value) => String(value)) : ["主题相关观察"],
			perspective: this.normalizePerspective(item.perspective),
			stance: this.normalizeStance(item.stance),
			recommendationReason: String(
				item.recommendationReason || `围绕“${topic}”，此专家具备相关公开表达与分析视角。`,
			),
			evidenceLabel: String(item.evidenceLabel || this.pickEvidenceLabel(evidenceScore)),
			evidenceScore,
			prominenceScore: this.normalizeScore(item.prominenceScore, 82),
			professionalScore: this.normalizeScore(item.professionalScore, 84),
			tier: this.normalizeTier(item.tier),
			recommended: Boolean(item.recommended),
			topicTags: Array.isArray(item.topicTags)
				? item.topicTags.map((value) => String(value))
				: this.buildTopicTags(topic),
			personaPrompt: String(
				item.personaPrompt || this.buildPersonaPrompt(String(item.name || "未知专家"), item, topic),
			),
		};
	}

	private extractJsonText(raw: string) {
		const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fenced?.[1]) {
			return fenced[1].trim();
		}

		const start = raw.indexOf("[");
		const end = raw.lastIndexOf("]");
		if (start >= 0 && end > start) {
			return raw.slice(start, end + 1);
		}

		return raw.trim();
	}

	private rankSeedExperts(topic: string, searchResults: WebSearchResultItem[]): DiscussionExpertCandidate[] {
		const topicKeywords = this.buildTopicTags(topic);
		const combinedText = searchResults
			.map((item) => `${item.title || ""}\n${item.content || ""}`)
			.join("\n")
			.toLowerCase();

		const candidates = expertSeeds
			.map((seed) => {
				const mentionScore = combinedText.includes(seed.name.toLowerCase()) ? 30 : 0;
				const keywordScore = seed.topicTags.reduce((score, tag) => {
					if (combinedText.includes(tag.toLowerCase())) {
						return score + 6;
					}
					if (topicKeywords.some((keyword) => tag.includes(keyword) || keyword.includes(tag))) {
						return score + 4;
					}
					return score;
				}, 0);

				const total = mentionScore + keywordScore + seed.prominenceScore * 0.55 + seed.professionalScore * 0.45;
				return {
					...seed,
					total,
				};
			})
			.sort((left, right) => right.total - left.total)
			.slice(0, 10)
			.map((seed, index) => ({
				id: `seed-${index + 1}`,
				name: seed.name,
				identity: seed.identity,
				organization: seed.organization,
				expertise: seed.expertise,
				perspective: seed.perspective,
				stance: seed.stance,
				recommendationReason: `已基于当前主题的联网搜索结果为 ${seed.name} 完成相关性排序，适合补充 ${seed.perspective} 视角。`,
				evidenceLabel: this.pickEvidenceLabel(seed.evidenceScore),
				evidenceScore: seed.evidenceScore,
				prominenceScore: seed.prominenceScore,
				professionalScore: seed.professionalScore,
				tier: seed.tier,
				recommended: false,
				topicTags: topicKeywords,
				personaPrompt: this.buildPersonaPrompt(seed.name, seed, topic),
			}));

		return this.markRecommended(candidates);
	}

	private markRecommended(candidates: DiscussionExpertCandidate[]) {
		const usedPerspectives = new Set<string>();
		const usedStances = new Set<string>();

		return candidates.map((candidate) => {
			const shouldRecommend =
				usedPerspectives.size < 5 &&
				(!usedPerspectives.has(candidate.perspective) || !usedStances.has(candidate.stance));

			if (shouldRecommend) {
				usedPerspectives.add(candidate.perspective);
				usedStances.add(candidate.stance);
			}

			return {
				...candidate,
				recommended: shouldRecommend || candidate.recommended,
			};
		});
	}

	private buildPersonaPrompt(name: string, item: Partial<DiscussionExpertCandidate>, topic: string) {
		const perspective = this.normalizePerspective(item.perspective);
		const stance = this.normalizeStance(item.stance);
		const expertise =
			Array.isArray(item.expertise) && item.expertise.length > 0 ? item.expertise.join("、") : "主题相关观察";

		return [
			`你现在扮演专家代理 ${name}。`,
			`身份背景：${item.identity || "公开身份待补充"}，所属机构：${item.organization || "公开机构待补充"}。`,
			`讨论视角：${perspective}；立场倾向：${stance}。`,
			`优先关注：${expertise}。`,
			`当前主题：${topic}。`,
			"输出语言固定为中文，风格介于专业圆桌评论与真实群聊之间。",
			"允许自主决定是否搜索公开资料，并向用户显露轻量过程状态。",
		].join("\n");
	}

	private buildTopicTags(topic: string) {
		return topic
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean)
			.slice(0, 8);
	}

	private normalizeScore(value: unknown, fallback: number) {
		const score = Number(value);
		if (Number.isNaN(score)) {
			return fallback;
		}
		return Math.max(0, Math.min(100, score));
	}

	private normalizePerspective(value: unknown) {
		const allowed: DiscussionParticipantPerspective[] = [
			"技术 / 产品",
			"学术 / 研究",
			"投资 / 商业",
			"产业 / 应用",
			"政策 / 治理",
		];
		return allowed.includes(String(value) as DiscussionParticipantPerspective)
			? (String(value) as DiscussionParticipantPerspective)
			: "投资 / 商业";
	}

	private normalizeStance(value: unknown) {
		const allowed: DiscussionParticipantStance[] = ["乐观推动", "审慎中立", "批判质疑"];
		return allowed.includes(String(value) as DiscussionParticipantStance)
			? (String(value) as DiscussionParticipantStance)
			: "审慎中立";
	}

	private normalizeTier(value: unknown): DiscussionParticipantTier {
		const allowed: DiscussionParticipantTier[] = ["临时专家", "可复用专家", "优选专家"];
		return allowed.includes(String(value) as DiscussionParticipantTier)
			? (String(value) as DiscussionParticipantTier)
			: "可复用专家";
	}

	private pickEvidenceLabel(score: number) {
		if (score >= 93) return "资料充分";
		if (score >= 86) return "资料较充分";
		return "资料有限";
	}

	private normalizeLimit(value: number | undefined, fallback: number) {
		const limit = Number(value || fallback);
		if (!Number.isFinite(limit)) {
			return fallback;
		}
		return Math.max(1, Math.min(Math.floor(limit), 10));
	}
}
