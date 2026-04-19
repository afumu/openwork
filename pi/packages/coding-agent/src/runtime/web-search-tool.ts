import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export interface WebSearchResultItem {
	title: string;
	link: string;
	content: string;
	media: string;
	time?: string;
}

export interface WebSearchToolOptions {
	url?: string;
	token?: string;
	defaultLimit?: number;
	fetchImpl?: typeof fetch;
}

export interface WebSearchToolDetails {
	items: WebSearchResultItem[];
	query: string;
	limit: number;
	depth: WebSearchDepth;
}

export type WebSearchDepth = "quick" | "balanced" | "deep";

const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 80;
const MAX_FORMATTED_SUMMARY_CHARS = 220;
const DEFAULT_SEARCH_DEPTH: WebSearchDepth = "balanced";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query for current web/news information." }),
	limit: Type.Optional(Type.Number({ description: "Maximum number of search results to return." })),
	depth: Type.Optional(
		Type.Union([Type.Literal("quick"), Type.Literal("balanced"), Type.Literal("deep")], {
			description: "How broadly the search center may expand enabled sources for this search.",
		}),
	),
});

export function createWebSearchTool(
	options: WebSearchToolOptions = {},
): AgentTool<typeof webSearchSchema, WebSearchToolDetails> {
	const url = options.url?.trim();
	const token = options.token?.trim();
	const defaultLimit = normalizeLimit(options.defaultLimit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
	const fetchImpl = options.fetchImpl ?? fetch;

	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web for current information. Use this when the user asks for latest, today's, recent, news, market, company, product, or other time-sensitive information.",
		parameters: webSearchSchema,
		execute: async (_toolCallId, input: { query: string; limit?: number; depth?: WebSearchDepth }, signal) => {
			const query = String(input.query || "").trim();
			const limit = normalizeLimit(input.limit, defaultLimit, defaultLimit);
			const depth = normalizeDepth(input.depth);

			if (!query) {
				return {
					content: [{ type: "text", text: "No search query was provided." }],
					details: { items: [], query, limit, depth },
				};
			}

			if (!url || !token) {
				return {
					content: [{ type: "text", text: "Web search is not configured in this runtime." }],
					details: { items: [], query, limit, depth },
				};
			}

			const response = await fetchImpl(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-openwork-internal-token": token,
				},
				body: JSON.stringify({ topic: query, limit, depth, scenario: "chat" }),
				signal,
			});

			if (!response.ok) {
				throw new Error(`Web search failed with status ${response.status}`);
			}

			const payload = await response.json();
			const items = extractSearchItems(payload).slice(0, limit);

			return {
				content: [
					{
						type: "text",
						text: formatSearchResultText(query, items),
					},
				],
				details: {
					items,
					query,
					limit,
					depth,
				},
			};
		},
	};
}

function normalizeLimit(value: number | undefined, fallback: number, maximum = MAX_SEARCH_LIMIT): number {
	const limit = Number(value || fallback);
	if (!Number.isFinite(limit)) {
		return fallback;
	}
	return Math.max(1, Math.min(Math.floor(limit), maximum));
}

function normalizeDepth(value: WebSearchDepth | undefined): WebSearchDepth {
	if (value === "quick" || value === "deep") {
		return value;
	}
	return DEFAULT_SEARCH_DEPTH;
}

function extractSearchItems(payload: unknown): WebSearchResultItem[] {
	const rawItems = extractRawItems(payload);
	return rawItems
		.map((item) => {
			const record = item as Record<string, unknown>;
			const title = String(record.title || "").trim();
			const link = String(record.link || record.url || "").trim();
			const content = String(record.content || record.summary || "")
				.replace(/\s+/g, " ")
				.trim();
			const media = String(record.media || record.source || "").trim();
			const time = String(record.time || "").trim();
			if (!title || !link) {
				return undefined;
			}
			return { title, link, content, media, ...(time ? { time } : {}) };
		})
		.filter((item): item is WebSearchResultItem => Boolean(item));
}

function extractRawItems(payload: unknown): unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (!payload || typeof payload !== "object") {
		return [];
	}

	const record = payload as { items?: unknown; data?: unknown };
	if (Array.isArray(record.items)) {
		return record.items;
	}
	if (record.data && typeof record.data === "object") {
		const data = record.data as { items?: unknown };
		if (Array.isArray(data.items)) {
			return data.items;
		}
	}
	return [];
}

function formatSearchResultText(query: string, items: WebSearchResultItem[]): string {
	if (!items.length) {
		return `No web search results were found for: ${query}`;
	}

	return [
		`Web search results for: ${query}`,
		...items.map((item, index) => {
			const source = item.media ? ` - ${item.media}` : "";
			const summary = item.content ? `\n   ${truncateSearchSummary(item.content)}` : "";
			return `${index + 1}. ${item.title}${source}\n   ${item.link}${summary}`;
		}),
	].join("\n");
}

function truncateSearchSummary(content: string): string {
	if (content.length <= MAX_FORMATTED_SUMMARY_CHARS) {
		return content;
	}
	return `${content.slice(0, MAX_FORMATTED_SUMMARY_CHARS).trimEnd()}...`;
}
