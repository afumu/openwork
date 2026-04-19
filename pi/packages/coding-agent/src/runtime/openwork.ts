import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	completeSimple,
	type ImageContent,
	type Tool as LlmTool,
	type Message,
	type Model,
	streamSimple,
	type TextContent,
	type ToolCall,
	type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { createToolDefinitionFromAgentTool } from "../core/tools/tool-definition-wrapper.js";
import {
	AuthStorage,
	type CreateAgentSessionResult,
	createAgentSession,
	createCodingTools,
	createEditTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	ModelRegistry,
} from "../index.js";
import { initTheme } from "../modes/interactive/theme/theme.js";
import {
	buildArtifactManifest,
	guessArtifactFileType,
	resolveArtifactFilePath,
	resolveWorkspaceDir,
} from "./artifact-workspace.js";
import { type DiscussionGatewayRequest, handleDiscussionGatewayRequest } from "./discussion/gateway.js";
import { createDiscussionRoomManager } from "./discussion/room-manager.js";
import {
	buildRequestScopedModelProxy,
	getRequestScopedModelAuth,
	hasRequestScopedModelProxy,
	type RequestScopedModelProxyConfig,
	shouldReuseSessionForRequestScopedModel,
} from "./model-proxy.js";
import { buildMinimalToolExecutionDelta, type MinimalToolExecutionPhase } from "./openai-tool-execution.js";
import { createInMemorySessionManagerForWorkspace } from "./session-workspace.js";
import { createWebSearchTool, type WebSearchResultItem } from "./web-search-tool.js";

const WEB_SEARCH_SYSTEM_PROMPT = [
	"When the web_search tool is available, it represents the user's explicit request to browse the web for this turn.",
	"Use web_search before answering questions about current, latest, today's, recent, time-sensitive, or externally verifiable information.",
	"If the first web_search result set is too small, stale, contradictory, or does not answer the user's question, refine the query and call web_search again.",
	"When you need a fast first pass, call web_search with depth='quick'. Use depth='balanced' by default. Use depth='deep' when the answer still lacks evidence after earlier searches.",
	"For complex current-information questions, prefer 2-3 targeted searches over relying on a single broad query.",
	"Treat the search limit as a per-call retrieval budget, not as a reason to stop gathering evidence when the answer is still under-supported.",
	"Do not say you cannot browse or cannot access real-time information while web_search is available.",
	"Use the returned search results as evidence, and cite source names or URLs when summarizing.",
	"web_search is a normal chat search tool for current and externally verifiable information.",
].join("\n");
const WEB_SEARCH_PROFILE_PROMPT_MARKER_START = "<web_search_capabilities>";
const WEB_SEARCH_PROFILE_PROMPT_MARKER_END = "</web_search_capabilities>";

type OpenAiMessageRole = "system" | "user" | "assistant" | "tool";

interface OpenAiTextPart {
	type: "text" | "input_text";
	text: string;
}

interface OpenAiImagePart {
	type: "image_url";
	image_url: string | { url: string; detail?: string };
}

interface OpenAiInputImagePart {
	type: "input_image";
	image_url?: string;
	image?: string;
}

type OpenAiContentPart = OpenAiTextPart | OpenAiImagePart | OpenAiInputImagePart;

interface OpenAiToolDefinition {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

interface OpenAiToolChoiceNamed {
	type: "function";
	function: {
		name: string;
	};
}

type OpenAiToolChoice = "auto" | "none" | "required" | OpenAiToolChoiceNamed;

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

interface OpenAiMessage {
	role: OpenAiMessageRole;
	content?: string | OpenAiContentPart[] | null;
	tool_call_id?: string;
	tool_calls?: OpenAiToolCall[];
}

interface OpenAiChatCompletionRequest {
	model?: string;
	messages?: OpenAiMessage[];
	stream?: boolean;
	tools?: OpenAiToolDefinition[];
	tool_choice?: OpenAiToolChoice;
	session_id?: string;
	conversation_id?: string;
	max_tokens?: number;
	group_id?: string | number;
	workspace_dir?: string;
	model_proxy?: RequestScopedModelProxyConfig;
	discussion_action?: DiscussionGatewayRequest["discussion_action"];
	discussion_room_id?: string;
	discussion_payload?: unknown;
	web_search_enabled?: boolean;
	web_search_limit?: number;
	web_search_profile?: WebSearchCapabilityProfile;
}

interface WebSearchCapabilityProfile {
	mode?: "fallback" | "aggregate" | "smart";
	capabilityGroups?: string[];
	enabledSources?: Array<{
		type?: string;
		name?: string;
		useForChat?: boolean;
		useForResearch?: boolean;
		capabilities?: string[];
	}>;
	guidance?: {
		recommendedDepth?: "quick" | "balanced" | "deep";
		supportsMultiRound?: boolean;
	};
}

interface AbortSessionRequest {
	session_id?: string;
	conversation_id?: string;
}

interface ArtifactListRequest {
	group_id?: string | number;
	workspace_dir?: string;
}

interface ArtifactReadRequest extends ArtifactListRequest {
	path?: string;
	run_id?: string;
}

interface ArtifactRewriteRequest extends ArtifactReadRequest {
	content?: string;
}

interface ParsedOpenAiRequest {
	systemPrompt: string;
	llmMessages: Message[];
	agentHistory: AgentMessage[];
	prompt?: string;
	canUseAgentSession: boolean;
	requiresDirectModelCall: boolean;
}

function _extractOpenAiMessageText(message: OpenAiMessage | undefined): string {
	if (!message) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content.trim();
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.map((part) => {
			if (part.type === "text" || part.type === "input_text") {
				return part.text ?? "";
			}
			return "";
		})
		.join("\n")
		.trim();
}

const port = Number(process.env.PORT ?? "8787");
const cwd = process.env.PI_OPENAI_CWD ?? process.cwd();
const workspaceRoot = resolvePath(process.env.PI_RUNTIME_WORKSPACE_ROOT ?? cwd);
const agentDir = process.env.PI_OPENAI_AGENT_DIR;
const toolsMode = (process.env.PI_OPENAI_TOOLS ?? "coding").toLowerCase();
const sessionTtlMs = Number(process.env.PI_OPENAI_SESSION_TTL_MS ?? `${30 * 60 * 1000}`);
const maxCachedSessions = Number(process.env.PI_OPENAI_MAX_SESSIONS ?? "100");
const tracePreviewChars = Number(process.env.PI_OPENAI_TRACE_PREVIEW_CHARS ?? "220");

initTheme(undefined, false);

const authStorage = AuthStorage.create(agentDir ? join(agentDir, "auth.json") : undefined);
const modelRegistry = ModelRegistry.create(authStorage, agentDir ? join(agentDir, "models.json") : undefined);
const defaultGetApiKeyAndHeaders = modelRegistry.getApiKeyAndHeaders.bind(modelRegistry);
const defaultHasConfiguredAuth = modelRegistry.hasConfiguredAuth.bind(modelRegistry);
modelRegistry.getApiKeyAndHeaders = async (model: Model<any>) =>
	getRequestScopedModelAuth(model) ?? defaultGetApiKeyAndHeaders(model);
modelRegistry.hasConfiguredAuth = (model: Model<any>) =>
	hasRequestScopedModelProxy(model) || defaultHasConfiguredAuth(model);

async function getAuthForModel(model: Model<any>) {
	const requestScopedAuth = getRequestScopedModelAuth(model);
	if (requestScopedAuth) {
		return requestScopedAuth;
	}
	return modelRegistry.getApiKeyAndHeaders(model);
}

function createWebSearchToolForRuntime(limit?: number) {
	return createWebSearchTool({
		url: process.env.OPENWORK_INTERNAL_SEARCH_URL,
		token: process.env.OPENWORK_INTERNAL_SEARCH_TOKEN,
		defaultLimit: limit ?? 40,
	});
}

function createToolsForCwd(targetCwd: string) {
	if (toolsMode === "none") {
		return [];
	}

	if (toolsMode === "readonly") {
		return createReadOnlyTools(targetCwd);
	}

	if (toolsMode === "restricted") {
		return [createReadTool(targetCwd), createEditTool(targetCwd), createWriteTool(targetCwd)];
	}

	return createCodingTools(targetCwd);
}

function createCustomToolDefinitionsForCwd(_targetCwd: string, webSearchEnabled = false, webSearchLimit?: number) {
	if (toolsMode === "none") {
		return [];
	}

	const webSearchTools = webSearchEnabled ? [createWebSearchToolForRuntime(webSearchLimit)] : [];

	return webSearchTools.map((tool) => createToolDefinitionFromAgentTool(tool));
}

let sharedResourceLoaderPromise: Promise<DefaultResourceLoader> | undefined;

interface CachedSessionEntry {
	sessionResult: CreateAgentSessionResult;
	lastUsedAt: number;
	modelKey: string | null;
	webSearchEnabled: boolean;
	webSearchLimit: number;
	workspaceDir: string;
}

const sessionCache = new Map<string, CachedSessionEntry>();
const discussionRoomManager = createDiscussionRoomManager();

function log(message: string, details?: unknown) {
	const prefix = `[pi-openai ${new Date().toISOString()}]`;
	if (details === undefined) {
		console.log(`${prefix} ${message}`);
		return;
	}
	console.log(`${prefix} ${message}`, details);
}

function truncateForTrace(value: string, max = tracePreviewChars) {
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, max)}...`;
}

function stringifyForTrace(value: unknown, max = tracePreviewChars) {
	try {
		const seen = new WeakSet<object>();
		const json = JSON.stringify(value, (_key, currentValue) => {
			if (typeof currentValue === "string") {
				return truncateForTrace(currentValue, Math.min(max, 180));
			}
			if (currentValue && typeof currentValue === "object") {
				if (seen.has(currentValue)) {
					return "[Circular]";
				}
				seen.add(currentValue);
			}
			return currentValue;
		});

		if (!json) {
			return String(value);
		}
		return truncateForTrace(json.replace(/\s+/g, " "), max);
	} catch {
		return truncateForTrace(String(value), max);
	}
}

function summarizeToolResultPayload(result: unknown) {
	if (!result || typeof result !== "object") {
		return result === undefined ? undefined : { preview: stringifyForTrace(result) };
	}

	const resultRecord = result as {
		content?: Array<{ type?: string; text?: string; mimeType?: string }>;
		details?: unknown;
	};
	const blocks = Array.isArray(resultRecord.content) ? resultRecord.content : [];
	const contentPreview = blocks
		.map((block) => {
			if (block?.type === "text") {
				return block.text ?? "";
			}
			if (block?.type === "image") {
				return `[image:${block.mimeType ?? "unknown"}]`;
			}
			return stringifyForTrace(block);
		})
		.filter(Boolean)
		.join(" | ");

	return {
		contentPreview: truncateForTrace(contentPreview || "(empty)"),
		detailsPreview: resultRecord.details === undefined ? undefined : stringifyForTrace(resultRecord.details),
	};
}

function toToolPreviewText(value: unknown, max = 140) {
	if (!value || typeof value !== "object") {
		const preview = stringifyForTrace(value, max);
		return preview === "undefined" ? undefined : preview;
	}

	const summarized = summarizeToolResultPayload(value) as
		| {
				contentPreview?: string;
				detailsPreview?: string;
				preview?: string;
		  }
		| undefined;

	const preview = summarized?.contentPreview ?? summarized?.detailsPreview ?? summarized?.preview;
	if (!preview) {
		return undefined;
	}

	return truncateForTrace(preview, max);
}

function extractWebSearchResultItems(value: unknown): WebSearchResultItem[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const details = (value as { details?: unknown }).details;
	if (!details || typeof details !== "object") {
		return [];
	}

	const items = (details as { items?: unknown }).items;
	return Array.isArray(items) ? (items as WebSearchResultItem[]) : [];
}

function toNetworkSearchResultPayload(items: WebSearchResultItem[]) {
	return JSON.stringify(
		items.map((item, index) => ({
			resultIndex: index + 1,
			title: item.title,
			link: item.link,
			content: item.content,
			media: item.media,
			time: item.time,
		})),
	);
}

function summarizeAgentMessage(message: AgentMessage | undefined) {
	if (!message) {
		return undefined;
	}

	if (message.role === "user") {
		const content = Array.isArray(message.content)
			? message.content
					.map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
					.filter(Boolean)
					.join(" | ")
			: message.content;
		return {
			role: "user",
			contentPreview: truncateForTrace(String(content ?? "")),
		};
	}

	if (message.role === "assistant") {
		return {
			role: "assistant",
			stopReason: message.stopReason,
			errorMessage: message.errorMessage,
			contentPreview: truncateForTrace(
				message.content
					.map((item) => {
						if (item.type === "text") return `text:${item.text}`;
						if (item.type === "thinking") return `thinking:${item.thinking}`;
						if (item.type === "toolCall") {
							return `toolCall:${item.name}#${item.id} args=${stringifyForTrace(item.arguments, 160)}`;
						}
						return "unknown";
					})
					.join(" | "),
			),
		};
	}

	if (message.role === "toolResult") {
		return {
			role: "toolResult",
			toolName: message.toolName,
			toolCallId: message.toolCallId,
			isError: message.isError,
			contentPreview: summarizeToolResultPayload({
				content: message.content,
				details: message.details,
			}),
		};
	}

	return {
		role: (message as { role?: string }).role ?? "unknown",
		preview: stringifyForTrace(message),
	};
}

function summarizeAssistantMessageEvent(event: AssistantMessageEvent) {
	switch (event.type) {
		case "start":
			return {
				type: "start",
				partial: summarizeAgentMessage(event.partial as AgentMessage),
			};
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return {
				type: "text_delta",
				contentIndex: event.contentIndex,
				delta: truncateForTrace(event.delta),
			};
		case "text_end":
			return {
				type: "text_end",
				contentIndex: event.contentIndex,
				contentPreview: truncateForTrace(event.content),
			};
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return {
				type: "thinking_delta",
				contentIndex: event.contentIndex,
				delta: truncateForTrace(event.delta),
			};
		case "thinking_end":
			return {
				type: "thinking_end",
				contentIndex: event.contentIndex,
				contentPreview: truncateForTrace(event.content),
			};
		case "toolcall_start": {
			const snapshot = getToolCallSnapshot({
				contentIndex: event.contentIndex,
				partial: event.partial,
			});
			return {
				type: "toolcall_start",
				contentIndex: event.contentIndex,
				toolCallId: snapshot?.toolCallId,
				toolName: snapshot?.toolName,
				argsPreview: snapshot?.args === undefined ? undefined : stringifyForTrace(snapshot.args),
			};
		}
		case "toolcall_delta": {
			const snapshot = getToolCallSnapshot({
				contentIndex: event.contentIndex,
				partial: event.partial,
			});
			return {
				type: "toolcall_delta",
				contentIndex: event.contentIndex,
				toolCallId: snapshot?.toolCallId,
				toolName: snapshot?.toolName,
				delta: truncateForTrace(event.delta),
				argsPreview: snapshot?.args === undefined ? undefined : stringifyForTrace(snapshot.args),
			};
		}
		case "toolcall_end": {
			const snapshot = getToolCallSnapshot({
				contentIndex: event.contentIndex,
				partial: event.partial,
				toolCall: event.toolCall,
			});
			return {
				type: "toolcall_end",
				contentIndex: event.contentIndex,
				toolCallId: snapshot?.toolCallId,
				toolName: snapshot?.toolName,
				argsPreview: snapshot?.args === undefined ? undefined : stringifyForTrace(snapshot.args),
			};
		}
		case "done":
			return {
				type: "done",
				reason: event.reason,
				message: summarizeAgentMessage(event.message as AgentMessage),
			};
		case "error":
			return {
				type: "error",
				reason: event.reason,
				error: summarizeAgentMessage(event.error as AgentMessage),
			};
		default:
			return {
				type: "unknown",
				preview: stringifyForTrace(event),
			};
	}
}

function summarizeAgentEvent(event: AgentEvent | { type: string; [key: string]: unknown }) {
	switch (event.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end": {
			const agentEndEvent = event as { messages?: AgentMessage[] };
			return {
				type: "agent_end",
				messageCount: agentEndEvent.messages?.length ?? 0,
			};
		}
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end": {
			const turnEndEvent = event as {
				message?: AgentMessage;
				toolResults?: unknown[];
			};
			return {
				type: "turn_end",
				message: summarizeAgentMessage(turnEndEvent.message),
				toolResultCount: turnEndEvent.toolResults?.length ?? 0,
			};
		}
		case "message_start": {
			const messageStartEvent = event as { message?: AgentMessage };
			return {
				type: "message_start",
				message: summarizeAgentMessage(messageStartEvent.message),
			};
		}
		case "message_update": {
			const messageUpdateEvent = event as {
				message?: AgentMessage;
				assistantMessageEvent: AssistantMessageEvent;
			};
			return {
				type: "message_update",
				messageRole: messageUpdateEvent.message?.role ?? "unknown",
				assistantEvent: summarizeAssistantMessageEvent(messageUpdateEvent.assistantMessageEvent),
			};
		}
		case "message_end": {
			const messageEndEvent = event as { message?: AgentMessage };
			return {
				type: "message_end",
				message: summarizeAgentMessage(messageEndEvent.message),
			};
		}
		case "tool_execution_start":
			return {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				argsPreview: stringifyForTrace(event.args),
			};
		case "tool_execution_update":
			return {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				argsPreview: stringifyForTrace(event.args),
				partialResult: summarizeToolResultPayload(event.partialResult),
			};
		case "tool_execution_end":
			return {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
				result: summarizeToolResultPayload(event.result),
			};
		case "queue_update":
			return {
				type: "queue_update",
				preview: stringifyForTrace(event),
			};
		default:
			return {
				type: "unknown",
				preview: stringifyForTrace(event),
			};
	}
}

function createTraceLogger(completionId: string, startedAt: number) {
	let step = 0;

	return {
		trace(label: string, details?: unknown) {
			step += 1;
			const prefix = `[pi-openai ${new Date().toISOString()}]`;
			const elapsedMs = Date.now() - startedAt;
			const stepLabel = String(step).padStart(4, "0");
			const detailsText =
				details === undefined ? "" : ` ${typeof details === "string" ? details : stringifyForTrace(details, 900)}`;
			console.log(`${prefix} [trace ${completionId} #${stepLabel} +${elapsedMs}ms] ${label}${detailsText}`);
		},
	};
}

function setCorsHeaders(res: ServerResponse) {
	if (res.headersSent || res.writableEnded || res.destroyed) {
		return;
	}
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function isResponseWritable(res: ServerResponse) {
	return !res.writableEnded && !res.destroyed;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
	if (!isResponseWritable(res) || res.headersSent) {
		return false;
	}
	setCorsHeaders(res);
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
	return true;
}

function sendOpenAiError(
	res: ServerResponse,
	statusCode: number,
	message: string,
	type = "invalid_request_error",
	code?: string,
) {
	return sendJson(res, statusCode, {
		error: {
			message,
			type,
			code: code ?? null,
		},
	});
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const raw = Buffer.concat(chunks).toString("utf8");
	const normalized = raw.replace(/^\uFEFF/, "");
	if (!normalized.trim()) {
		return {};
	}

	return JSON.parse(normalized);
}

function writeSseChunk(res: ServerResponse, data: unknown) {
	if (!isResponseWritable(res)) {
		return false;
	}
	res.write(`data: ${JSON.stringify(data)}\n\n`);
	return true;
}

function endSseStream(res: ServerResponse) {
	if (!isResponseWritable(res)) {
		return false;
	}
	res.end();
	return true;
}

function createActivityLogger(completionId: string, startedAt: number) {
	let lastActivityAt = Date.now();
	let lastActivity = "request_started";
	let stopped = false;
	let windowStartedAt = Date.now();
	let counts = {
		thinkingDeltas: 0,
		textDeltas: 0,
		toolCallStarts: 0,
		toolCallDeltas: 0,
		toolCallEnds: 0,
		toolStarts: 0,
		toolUpdates: 0,
		toolEnds: 0,
		agentStarts: 0,
		agentEnds: 0,
		otherEvents: 0,
	};
	const interval = setInterval(() => {
		if (stopped) return;
		const now = Date.now();
		const elapsedMs = now - startedAt;
		const idleMs = Date.now() - lastActivityAt;
		log("request still active", {
			completionId,
			elapsedMs,
			idleMs,
			lastActivity,
			windowMs: now - windowStartedAt,
			counts,
		});
		windowStartedAt = now;
		counts = {
			thinkingDeltas: 0,
			textDeltas: 0,
			toolCallStarts: 0,
			toolCallDeltas: 0,
			toolCallEnds: 0,
			toolStarts: 0,
			toolUpdates: 0,
			toolEnds: 0,
			agentStarts: 0,
			agentEnds: 0,
			otherEvents: 0,
		};
	}, 10000);

	return {
		mark(activity: string) {
			if (stopped) return;
			lastActivityAt = Date.now();
			lastActivity = activity;
		},
		record(eventType: keyof typeof counts) {
			if (stopped) return;
			counts[eventType] += 1;
		},
		stop() {
			if (stopped) return;
			stopped = true;
			clearInterval(interval);
		},
	};
}

function buildToolExecutionDelta(
	event: "start" | "update" | "end",
	toolName: string,
	toolCallId: string,
	phase: MinimalToolExecutionPhase,
	extra?: Record<string, unknown>,
) {
	return buildMinimalToolExecutionDelta(event, toolName, toolCallId, phase, extra);
}

function getToolCallSnapshot(options: {
	contentIndex: number;
	partial?: AssistantMessage;
	toolCall?: ToolCall;
}): { toolCallId: string; toolName: string; args: unknown } | undefined {
	const partialContent = options.partial?.content[options.contentIndex];
	if (partialContent?.type === "toolCall") {
		return {
			toolCallId: partialContent.id,
			toolName: partialContent.name,
			args: partialContent.arguments,
		};
	}

	if (options.toolCall) {
		return {
			toolCallId: options.toolCall.id,
			toolName: options.toolCall.name,
			args: options.toolCall.arguments,
		};
	}

	return undefined;
}

function buildArgsPreview(args: unknown) {
	return truncateForTrace(stringifyForTrace(args, 140), 140);
}

function emitToolExecutionChunk(options: {
	res: ServerResponse;
	completionId: string;
	responseModel: string;
	toolName: string;
	toolCallId: string;
	event: "start" | "update" | "end";
	phase: MinimalToolExecutionPhase;
	extra?: Record<string, unknown>;
}) {
	writeSseChunk(options.res, {
		id: options.completionId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: options.responseModel,
		service_tier: "default",
		choices: [
			{
				index: 0,
				delta: buildToolExecutionDelta(
					options.event,
					options.toolName,
					options.toolCallId,
					options.phase,
					options.extra,
				),
				finish_reason: null,
			},
		],
		usage: null,
	});
}

function normalizeTextOnlyContent(content: OpenAiMessage["content"]): string {
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((part) => {
			if (part.type === "text" || part.type === "input_text") {
				return part.text ?? "";
			}
			return "";
		})
		.join("");
}

async function imageUrlToContent(imageUrl: string): Promise<ImageContent> {
	if (imageUrl.startsWith("data:")) {
		const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
		if (!match) {
			throw new Error("Unsupported data URL image format. Only base64 data URLs are supported.");
		}

		return {
			type: "image",
			mimeType: match[1],
			data: match[2],
		};
	}

	const response = await fetch(imageUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch image URL: ${imageUrl} (${response.status})`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const mimeType = response.headers.get("content-type") || "image/png";

	return {
		type: "image",
		mimeType,
		data: Buffer.from(arrayBuffer).toString("base64"),
	};
}

async function parseOpenAiUserContent(
	content: OpenAiMessage["content"],
): Promise<{ blocks: (TextContent | ImageContent)[]; hasImages: boolean }> {
	if (typeof content === "string") {
		return {
			blocks: [{ type: "text", text: content }],
			hasImages: false,
		};
	}

	if (!Array.isArray(content)) {
		return {
			blocks: [],
			hasImages: false,
		};
	}

	const blocks: (TextContent | ImageContent)[] = [];
	let hasImages = false;

	for (const part of content) {
		if (part.type === "text" || part.type === "input_text") {
			blocks.push({ type: "text", text: part.text ?? "" });
			continue;
		}

		if (part.type === "image_url") {
			const url = typeof part.image_url === "string" ? part.image_url : part.image_url.url;
			blocks.push(await imageUrlToContent(url));
			hasImages = true;
			continue;
		}

		if (part.type === "input_image") {
			const url = part.image_url ?? part.image;
			if (!url) {
				throw new Error("input_image part is missing `image_url` or `image`.");
			}
			blocks.push(await imageUrlToContent(url));
			hasImages = true;
		}
	}

	return { blocks, hasImages };
}

function createZeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

async function parseMessages(
	messages: OpenAiMessage[],
	requestTools?: OpenAiToolDefinition[],
): Promise<ParsedOpenAiRequest> {
	const systemPromptParts: string[] = [];
	const llmMessages: Message[] = [];
	const agentHistory: AgentMessage[] = [];
	const toolNameById = new Map<string, string>();

	let canUseAgentSession = !requestTools || requestTools.length === 0;
	let requiresDirectModelCall = !canUseAgentSession;

	const nonSystemMessages = messages.filter((message) => message.role !== "system");
	const lastNonSystem = nonSystemMessages[nonSystemMessages.length - 1];

	for (const message of messages) {
		if (message.role === "system") {
			const systemText = normalizeTextOnlyContent(message.content);
			if (systemText) {
				systemPromptParts.push(systemText);
			}
			continue;
		}

		if (message.role === "user") {
			const parsed = await parseOpenAiUserContent(message.content);
			const payload =
				parsed.blocks.length === 1 && parsed.blocks[0].type === "text" ? parsed.blocks[0].text : parsed.blocks;
			llmMessages.push({
				role: "user",
				content: payload,
				timestamp: Date.now(),
			});
			agentHistory.push({
				role: "user",
				content: payload,
				timestamp: Date.now(),
			});

			if (parsed.hasImages) {
				canUseAgentSession = false;
				requiresDirectModelCall = true;
			}
			continue;
		}

		if (message.role === "assistant") {
			const text = normalizeTextOnlyContent(message.content);
			const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((toolCall) => {
				let parsedArgs: Record<string, unknown>;
				try {
					parsedArgs = toolCall.function.arguments
						? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
						: {};
				} catch {
					parsedArgs = {};
				}
				toolNameById.set(toolCall.id, toolCall.function.name);
				return {
					type: "toolCall",
					id: toolCall.id,
					name: toolCall.function.name,
					arguments: parsedArgs,
				};
			});

			const contentBlocks: AssistantMessage["content"] = [];
			if (text) {
				contentBlocks.push({ type: "text", text });
			}
			contentBlocks.push(...toolCalls);

			llmMessages.push({
				role: "assistant",
				content: contentBlocks,
				api: "unknown",
				provider: "unknown",
				model: "unknown",
				usage: createZeroUsage(),
				stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
				timestamp: Date.now(),
			});

			agentHistory.push({
				role: "assistant",
				content: contentBlocks,
				api: "unknown",
				provider: "unknown",
				model: "unknown",
				usage: createZeroUsage(),
				stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
				timestamp: Date.now(),
			});

			if (toolCalls.length > 0) {
				canUseAgentSession = false;
				requiresDirectModelCall = true;
			}
			continue;
		}

		if (message.role === "tool") {
			const toolText = normalizeTextOnlyContent(message.content);
			const toolName = message.tool_call_id ? (toolNameById.get(message.tool_call_id) ?? "tool") : "tool";
			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: message.tool_call_id ?? randomUUID(),
				toolName,
				content: [{ type: "text", text: toolText }],
				isError: false,
				timestamp: Date.now(),
			};

			llmMessages.push(toolResult);
			agentHistory.push(toolResult);
			canUseAgentSession = false;
			requiresDirectModelCall = true;
		}
	}

	if (!lastNonSystem) {
		throw new Error("At least one non-system message is required.");
	}

	if (lastNonSystem.role !== "user") {
		canUseAgentSession = false;
		requiresDirectModelCall = true;
	}

	const prompt = lastNonSystem.role === "user" ? normalizeTextOnlyContent(lastNonSystem.content) : undefined;

	if (lastNonSystem.role === "user" && !prompt?.trim()) {
		// This still might be okay for multimodal direct requests.
		const parsed = await parseOpenAiUserContent(lastNonSystem.content);
		if (!parsed.hasImages) {
			throw new Error("The final user message must contain text or image content.");
		}
		canUseAgentSession = false;
		requiresDirectModelCall = true;
	}

	// The agent path expects the final user prompt to be sent separately, not already in history.
	if (canUseAgentSession && agentHistory.length > 0 && lastNonSystem.role === "user") {
		agentHistory.pop();
	}

	return {
		systemPrompt: systemPromptParts.join("\n\n"),
		llmMessages,
		agentHistory,
		prompt,
		canUseAgentSession,
		requiresDirectModelCall,
	};
}

async function resolveModel(
	requestedModel?: string,
	requestScopedModelProxy?: RequestScopedModelProxyConfig,
): Promise<Model<any> | undefined> {
	if (requestScopedModelProxy) {
		return buildRequestScopedModelProxy(requestScopedModelProxy);
	}

	const availableModels = modelRegistry.getAvailable();

	if (!requestedModel) {
		return undefined;
	}

	return (
		availableModels.find(
			(model) => `${model.provider}/${model.id}` === requestedModel || model.id === requestedModel,
		) ?? undefined
	);
}

function isDiscussionCompletionRequest(request: OpenAiChatCompletionRequest) {
	return Boolean(request.discussion_action);
}

async function resolveDiscussionModel(
	requestedModel?: string,
	requestScopedModelProxy?: RequestScopedModelProxyConfig,
): Promise<Model<any> | undefined> {
	if (requestScopedModelProxy) {
		return buildRequestScopedModelProxy(requestScopedModelProxy);
	}
	if (requestedModel) {
		return resolveModel(requestedModel);
	}
	return modelRegistry.getAvailable()[0];
}

function createDiscussionSearchDependency(limit?: number) {
	const tool = createWebSearchToolForRuntime(limit);
	return async (query: string, searchLimit: number, signal?: AbortSignal) => {
		const result = await tool.execute(`discussion-search-${randomUUID()}`, { query, limit: searchLimit }, signal);
		return extractWebSearchResultItems(result);
	};
}

function createDiscussionGenerateTextDependency(model: Model<any>) {
	return async (input: { systemPrompt: string; userPrompt: string; signal?: AbortSignal }) => {
		const auth = await getAuthForModel(model);
		if (!auth.ok) {
			throw new Error(auth.error);
		}
		const assistant = await completeSimple(
			model,
			{
				systemPrompt: input.systemPrompt,
				messages: [
					{
						role: "user",
						content: input.userPrompt,
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				reasoning: "medium",
				signal: input.signal,
			},
		);
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
			throw new Error(assistant.errorMessage ?? "Discussion model execution failed.");
		}
		return extractAssistantText(assistant).trim();
	};
}

async function handleDiscussionCompletion(
	body: OpenAiChatCompletionRequest,
	res: ServerResponse,
	startedAt: number,
	signal?: AbortSignal,
) {
	const model = await resolveDiscussionModel(body.model, body.model_proxy);
	if (body.model && !model) {
		sendOpenAiError(res, 400, `Configured local model not found: ${body.model}`, "invalid_model", "model_not_found");
		return;
	}
	if (!model) {
		sendOpenAiError(res, 500, "No local PI model is available. Please configure a model first.", "server_error");
		return;
	}

	const responseModel = `${model.provider}/${model.id}`;
	const completionId = `chatcmpl-${randomUUID()}`;
	const result = await handleDiscussionGatewayRequest(discussionRoomManager, body, {
		discoveryDependencies: {
			generateText: createDiscussionGenerateTextDependency(model),
			search: createDiscussionSearchDependency(normalizeWebSearchLimit(body.web_search_limit, 20)),
		},
		signal,
	});
	const text = JSON.stringify(result);

	if (body.stream) {
		setCorsHeaders(res);
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache, no-transform");
		res.setHeader("Connection", "keep-alive");
		writeSseChunk(res, {
			id: completionId,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: responseModel,
			service_tier: "default",
			choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			usage: null,
		});
		writeAssistantContentChunk(res, completionId, responseModel, text);
		writeSseChunk(res, {
			id: completionId,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: responseModel,
			service_tier: "default",
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: null,
		});
		res.write("data: [DONE]\n\n");
		res.end();
		return;
	}

	sendJson(res, 200, buildTextOnlyChatCompletionResponse(completionId, responseModel, text));
	log("discussion runtime response completed", {
		completionId,
		elapsedMs: Date.now() - startedAt,
		action: body.discussion_action ?? null,
	});
}

async function getSharedResourceLoader() {
	if (!sharedResourceLoaderPromise) {
		sharedResourceLoaderPromise = (async () => {
			const startedAt = Date.now();
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
			});
			await resourceLoader.reload();
			log("shared resource loader ready", {
				elapsedMs: Date.now() - startedAt,
			});
			return resourceLoader;
		})().catch((error) => {
			sharedResourceLoaderPromise = undefined;
			throw error;
		});
	}

	return sharedResourceLoaderPromise;
}

function getSessionCacheKey(request: OpenAiChatCompletionRequest): string | undefined {
	return request.session_id ?? request.conversation_id ?? undefined;
}

function normalizeWebSearchLimit(value: number | undefined, fallback: number): number {
	const limit = Number(value || fallback);
	if (!Number.isFinite(limit)) {
		return fallback;
	}
	return Math.max(1, Math.min(Math.floor(limit), 80));
}

function disposeCachedSession(cacheKey: string) {
	const entry = sessionCache.get(cacheKey);
	if (!entry) return;

	entry.sessionResult.session.dispose();
	sessionCache.delete(cacheKey);
	log("cached session disposed", { cacheKey });
}

async function abortCachedSession(cacheKey: string) {
	const entry = sessionCache.get(cacheKey);
	if (!entry) {
		return false;
	}

	await entry.sessionResult.session.abort();
	entry.lastUsedAt = Date.now();
	log("cached session aborted", { cacheKey });
	return true;
}

function sweepExpiredSessions() {
	const now = Date.now();

	for (const [cacheKey, entry] of sessionCache.entries()) {
		if (now - entry.lastUsedAt > sessionTtlMs) {
			disposeCachedSession(cacheKey);
		}
	}

	while (sessionCache.size > maxCachedSessions) {
		const oldest = [...sessionCache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
		if (!oldest) break;
		disposeCachedSession(oldest[0]);
	}
}

function extractAssistantText(message?: AssistantMessage): string {
	if (!message) return "";

	return message.content
		.filter((item): item is Extract<AssistantMessage["content"][number], { type: "text" }> => item.type === "text")
		.map((item) => item.text)
		.join("");
}

function extractAssistantReasoning(message?: AssistantMessage): string {
	if (!message) return "";

	return message.content
		.filter(
			(item): item is Extract<AssistantMessage["content"][number], { type: "thinking" }> => item.type === "thinking",
		)
		.map((item) => item.thinking)
		.join("");
}

function findLastAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

function mapFinishReason(stopReason: AssistantMessage["stopReason"] | undefined): "stop" | "length" | "tool_calls" {
	switch (stopReason) {
		case "length":
			return "length";
		case "toolUse":
			return "tool_calls";
		default:
			return "stop";
	}
}

function usageFromAssistant(message?: AssistantMessage) {
	const usage = message?.usage;
	if (!usage) {
		return undefined;
	}

	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	const completionTokens = usage.output;

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
	};
}

function toOpenAiToolCalls(message?: AssistantMessage): OpenAiToolCall[] | undefined {
	if (!message) return undefined;

	const toolCalls = message.content.filter(
		(item): item is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => item.type === "toolCall",
	);

	if (toolCalls.length === 0) {
		return undefined;
	}

	return toolCalls.map((toolCall) => ({
		id: toolCall.id,
		type: "function",
		function: {
			name: toolCall.name,
			arguments: JSON.stringify(toolCall.arguments ?? {}),
		},
	}));
}

function buildChatCompletionResponse(id: string, model: string, assistant?: AssistantMessage) {
	const text = extractAssistantText(assistant);
	const reasoning = extractAssistantReasoning(assistant);
	const toolCalls = toOpenAiToolCalls(assistant);
	return {
		id,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: text || null,
					...(reasoning ? { reasoning_content: reasoning } : {}),
					...(toolCalls ? { tool_calls: toolCalls } : {}),
				},
				finish_reason: mapFinishReason(assistant?.stopReason),
			},
		],
		usage: usageFromAssistant(assistant),
	};
}

function buildTextOnlyChatCompletionResponse(id: string, model: string, text: string) {
	return {
		id,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: text,
				},
				finish_reason: "stop",
			},
		],
	};
}

function writeAssistantContentChunk(res: ServerResponse, completionId: string, responseModel: string, text: string) {
	writeSseChunk(res, {
		id: completionId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: responseModel,
		service_tier: "default",
		choices: [
			{
				index: 0,
				delta: { content: text },
				finish_reason: null,
			},
		],
		usage: null,
	});
}

function _writeToolExecutionChunk(
	res: ServerResponse,
	completionId: string,
	responseModel: string,
	delta: ReturnType<typeof buildToolExecutionDelta>,
) {
	writeSseChunk(res, {
		id: completionId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: responseModel,
		service_tier: "default",
		choices: [
			{
				index: 0,
				delta,
				finish_reason: null,
			},
		],
		usage: null,
	});
}

function openAiToolToLlmTool(tool: OpenAiToolDefinition): LlmTool {
	return {
		name: tool.function.name,
		description: tool.function.description ?? "",
		parameters: Type.Unsafe(
			tool.function.parameters ?? {
				type: "object",
				properties: {},
				additionalProperties: true,
			},
		),
	};
}

function applyToolChoice(
	tools: LlmTool[],
	toolChoice: OpenAiToolChoice | undefined,
	systemPrompt: string,
): { tools: LlmTool[]; systemPrompt: string } {
	if (!toolChoice || toolChoice === "auto") {
		return { tools, systemPrompt };
	}

	if (toolChoice === "none") {
		return { tools: [], systemPrompt };
	}

	if (toolChoice === "required") {
		const instruction = "You must call at least one tool before providing your final answer.";
		return {
			tools,
			systemPrompt: systemPrompt ? `${systemPrompt}\n\n${instruction}` : instruction,
		};
	}

	const selected = tools.filter((tool) => tool.name === toolChoice.function.name);
	return {
		tools: selected,
		systemPrompt,
	};
}

async function createSessionForRequest(
	workspaceDir: string,
	model?: Model<any>,
	webSearchEnabled = false,
	webSearchLimit = 40,
) {
	await fs.mkdir(workspaceDir, { recursive: true });
	const resourceLoader = await getSharedResourceLoader();

	return createAgentSession({
		cwd: workspaceDir,
		agentDir,
		authStorage,
		modelRegistry,
		model,
		resourceLoader,
		sessionManager: createInMemorySessionManagerForWorkspace(workspaceDir),
		tools: createToolsForCwd(workspaceDir),
		customTools: createCustomToolDefinitionsForCwd(workspaceDir, webSearchEnabled, webSearchLimit),
	});
}

async function getOrCreateSessionForRequest(request: OpenAiChatCompletionRequest, model?: Model<any>) {
	sweepExpiredSessions();

	const cacheKey = shouldReuseSessionForRequestScopedModel(model) ? getSessionCacheKey(request) : undefined;
	const modelKey = model ? `${model.provider}/${model.id}` : null;
	const webSearchEnabled = request.web_search_enabled === true;
	const webSearchLimit = normalizeWebSearchLimit(request.web_search_limit, 40);
	const workspaceDir = resolveWorkspaceDir({
		rawWorkspaceDir: request.workspace_dir,
		workspaceRoot,
	});

	if (!cacheKey) {
		return {
			...(await createSessionForRequest(workspaceDir, model, webSearchEnabled, webSearchLimit)),
			cacheKey: undefined,
			isReusable: false,
			isNewSession: true,
		};
	}

	const existing = sessionCache.get(cacheKey);
	if (existing) {
		if (
			(existing.modelKey && modelKey && existing.modelKey !== modelKey) ||
			existing.workspaceDir !== workspaceDir ||
			existing.webSearchEnabled !== webSearchEnabled ||
			existing.webSearchLimit !== webSearchLimit
		) {
			disposeCachedSession(cacheKey);
		} else {
			existing.lastUsedAt = Date.now();
			log("reusing cached session", {
				cacheKey,
				modelKey: existing.modelKey,
				webSearchEnabled: existing.webSearchEnabled,
				webSearchLimit: existing.webSearchLimit,
			});
			return {
				...existing.sessionResult,
				cacheKey,
				isReusable: true,
				isNewSession: false,
			};
		}
	}

	const sessionResult = await createSessionForRequest(workspaceDir, model, webSearchEnabled, webSearchLimit);
	sessionCache.set(cacheKey, {
		sessionResult,
		lastUsedAt: Date.now(),
		modelKey,
		webSearchEnabled,
		webSearchLimit,
		workspaceDir,
	});
	log("cached new session", { cacheKey, modelKey, webSearchEnabled, webSearchLimit });
	return {
		...sessionResult,
		cacheKey,
		isReusable: true,
		isNewSession: true,
	};
}

function mergeSystemPrompt(basePrompt: string | undefined, requestPrompt: string): string | undefined {
	const trimmedBase = basePrompt?.trim();
	const trimmedRequest = requestPrompt.trim();

	if (!trimmedRequest) {
		return trimmedBase;
	}

	return trimmedBase ? `${trimmedBase}\n\n${trimmedRequest}` : trimmedRequest;
}

function buildWebSearchCapabilityPrompt(profile: WebSearchCapabilityProfile | undefined): string {
	if (!profile) {
		return "";
	}

	const capabilityGroups = (profile.capabilityGroups ?? []).filter(Boolean);
	const enabledSources = (profile.enabledSources ?? [])
		.map((source) => {
			const label = source.name?.trim() || source.type?.trim() || "source";
			const capabilities = (source.capabilities ?? []).filter(Boolean);
			const capabilitySuffix = capabilities.length ? ` (${capabilities.join(", ")})` : "";
			return `- ${label}${capabilitySuffix}`;
		})
		.slice(0, 12);

	if (capabilityGroups.length === 0 && enabledSources.length === 0) {
		return "";
	}

	const lines = [
		WEB_SEARCH_PROFILE_PROMPT_MARKER_START,
		`Search center mode: ${profile.mode ?? "fallback"}.`,
		capabilityGroups.length
			? `Available search capability groups: ${capabilityGroups.join(", ")}.`
			: "Available search capability groups were not provided.",
		enabledSources.length
			? `Enabled search sources:\n${enabledSources.join("\n")}`
			: "Enabled search sources were not provided.",
		"The search center chooses the actual enabled providers. You should reason in terms of capability groups and search depth, not raw provider names.",
		`Default search depth: ${profile.guidance?.recommendedDepth ?? "balanced"}.`,
		profile.guidance?.supportsMultiRound === false
			? "Do not assume the search center supports multi-round expansion."
			: "The search center supports multi-round searching when more evidence is needed.",
		WEB_SEARCH_PROFILE_PROMPT_MARKER_END,
	];

	return lines.join("\n");
}

function upsertWebSearchPrompt(
	basePrompt: string | undefined,
	profile: WebSearchCapabilityProfile | undefined,
	isEnabled: boolean,
): string | undefined {
	const withoutPreviousProfile = (basePrompt ?? "")
		.replace(
			new RegExp(
				`${WEB_SEARCH_PROFILE_PROMPT_MARKER_START}[\\s\\S]*?${WEB_SEARCH_PROFILE_PROMPT_MARKER_END}\\n*`,
				"g",
			),
			"",
		)
		.trim();
	const withBasePrompt = isEnabled
		? mergeSystemPrompt(withoutPreviousProfile, WEB_SEARCH_SYSTEM_PROMPT)
		: withoutPreviousProfile || undefined;
	if (!isEnabled) {
		return withBasePrompt;
	}
	const capabilityPrompt = buildWebSearchCapabilityPrompt(profile);
	return capabilityPrompt ? mergeSystemPrompt(withBasePrompt, capabilityPrompt) : withBasePrompt;
}

async function runDirectModelRequest(options: {
	session: Awaited<ReturnType<typeof createSessionForRequest>>["session"];
	prepared: ParsedOpenAiRequest;
	request: OpenAiChatCompletionRequest;
	req: IncomingMessage;
	res: ServerResponse;
	completionId: string;
	responseModel: string;
	startedAt: number;
	activityLogger: ReturnType<typeof createActivityLogger>;
	traceLogger: ReturnType<typeof createTraceLogger>;
}) {
	const { session, prepared, request, req, res, completionId, responseModel, startedAt, activityLogger, traceLogger } =
		options;

	const effectiveModel = session.model;
	if (!effectiveModel) {
		throw new Error("No effective model is available for direct model execution.");
	}

	const auth = await getAuthForModel(effectiveModel);
	if (!auth.ok) {
		throw new Error(auth.error);
	}

	const requestTools = (request.tools ?? []).map(openAiToolToLlmTool);
	const withChoice = applyToolChoice(
		requestTools,
		request.tool_choice,
		mergeSystemPrompt(session.agent.state.systemPrompt, prepared.systemPrompt) ?? "",
	);

	log("running direct model path", {
		completionId,
		model: responseModel,
		requestTools: request.tools?.length ?? 0,
		exposedTools: withChoice.tools.length,
	});
	traceLogger.trace("direct-model.start", {
		model: responseModel,
		requestTools: request.tools?.length ?? 0,
		exposedTools: withChoice.tools.length,
		messageCount: prepared.llmMessages.length,
	});

	const abortController = new AbortController();
	const onClose = () => {
		log("client connection closed during direct model path", { completionId });
		activityLogger.mark("client_close");
		traceLogger.trace("connection.client_close", { path: "direct-model" });
		abortController.abort();
	};
	req.on("close", onClose);

	try {
		const stream = await streamSimple(
			effectiveModel,
			{
				systemPrompt: withChoice.systemPrompt,
				messages: prepared.llmMessages,
				tools: withChoice.tools,
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				reasoning: session.thinkingLevel === "off" ? undefined : session.thinkingLevel,
				signal: abortController.signal,
			},
		);

		if (request.stream) {
			setCorsHeaders(res);
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");

			writeSseChunk(res, {
				id: completionId,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: responseModel,
				service_tier: "default",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
				usage: null,
			});

			const toolIndexByContentIndex = new Map<number, number>();
			let nextToolIndex = 0;

			for await (const event of stream) {
				activityLogger.mark(`direct_model:${event.type}`);
				traceLogger.trace(`direct-model.event.${event.type}`, summarizeAssistantMessageEvent(event));
				if (event.type === "thinking_delta") {
					activityLogger.record("thinkingDeltas");
					writeSseChunk(res, {
						id: completionId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: responseModel,
						service_tier: "default",
						choices: [
							{
								index: 0,
								delta: {
									content: "",
									reasoning_content: event.delta,
								},
								finish_reason: null,
							},
						],
						usage: null,
					});
					continue;
				}

				if (event.type === "text_delta") {
					activityLogger.record("textDeltas");
					writeSseChunk(res, {
						id: completionId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: responseModel,
						service_tier: "default",
						choices: [
							{
								index: 0,
								delta: { content: event.delta },
								finish_reason: null,
							},
						],
						usage: null,
					});
					continue;
				}

				if (event.type === "toolcall_start") {
					activityLogger.record("toolCallStarts");
					const toolCall = event.partial.content[event.contentIndex];
					if (toolCall?.type === "toolCall") {
						const toolIndex = nextToolIndex++;
						toolIndexByContentIndex.set(event.contentIndex, toolIndex);
						writeSseChunk(res, {
							id: completionId,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: responseModel,
							service_tier: "default",
							choices: [
								{
									index: 0,
									delta: {
										tool_calls: [
											{
												index: toolIndex,
												id: toolCall.id,
												type: "function",
												function: {
													name: toolCall.name,
													arguments: "",
												},
											},
										],
									},
									finish_reason: null,
								},
							],
							usage: null,
						});
					}
					continue;
				}

				if (event.type === "toolcall_delta") {
					activityLogger.record("toolCallDeltas");
					const toolCall = event.partial.content[event.contentIndex];
					const toolIndex = toolIndexByContentIndex.get(event.contentIndex) ?? nextToolIndex++;
					toolIndexByContentIndex.set(event.contentIndex, toolIndex);
					writeSseChunk(res, {
						id: completionId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: responseModel,
						service_tier: "default",
						choices: [
							{
								index: 0,
								delta: {
									tool_calls: [
										{
											index: toolIndex,
											id: toolCall?.type === "toolCall" ? toolCall.id : undefined,
											type: "function",
											function: {
												name: toolCall?.type === "toolCall" ? toolCall.name : undefined,
												arguments: event.delta,
											},
										},
									],
								},
								finish_reason: null,
							},
						],
						usage: null,
					});
					continue;
				}

				if (event.type === "toolcall_end") {
					activityLogger.record("toolCallEnds");
				}
			}

			const assistant = await stream.result();
			traceLogger.trace("direct-model.result", summarizeAgentMessage(assistant as AgentMessage));
			writeSseChunk(res, {
				id: completionId,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: responseModel,
				service_tier: "default",
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: mapFinishReason(assistant.stopReason),
					},
				],
				usage: null,
			});
			res.write("data: [DONE]\n\n");
			activityLogger.stop();
			res.end();

			log("streaming direct model response completed", {
				completionId,
				finishReason: mapFinishReason(assistant.stopReason),
				elapsedMs: Date.now() - startedAt,
			});
			return;
		}

		const assistant = await stream.result();
		traceLogger.trace("direct-model.result", summarizeAgentMessage(assistant as AgentMessage));
		sendJson(res, 200, buildChatCompletionResponse(completionId, responseModel, assistant));
		log("non-stream direct model response completed", {
			completionId,
			finishReason: mapFinishReason(assistant.stopReason),
			elapsedMs: Date.now() - startedAt,
		});
	} finally {
		activityLogger.stop();
		req.off("close", onClose);
		traceLogger.trace("direct-model.finish");
	}
}

async function handleChatCompletions(req: IncomingMessage, res: ServerResponse) {
	const startedAt = Date.now();
	log("incoming chat completion request", { method: req.method, url: req.url });

	let body: OpenAiChatCompletionRequest;
	try {
		body = (await readJsonBody(req)) as OpenAiChatCompletionRequest;
	} catch (error) {
		log("failed to parse request body", error instanceof Error ? error.message : String(error));
		sendOpenAiError(res, 400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	log("request body parsed", {
		stream: body.stream === true,
		model: body.model ?? null,
		messageCount: Array.isArray(body.messages) ? body.messages.length : null,
		toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
		toolChoice: body.tool_choice ?? "auto",
		discussionAction: body.discussion_action ?? null,
	});

	if (isDiscussionCompletionRequest(body)) {
		const abortController = new AbortController();
		const onClose = () => abortController.abort();
		req.on("close", onClose);
		try {
			await handleDiscussionCompletion(body, res, startedAt, abortController.signal);
		} catch (error) {
			log("discussion runtime request failed", error instanceof Error ? error.message : String(error));
			sendOpenAiError(res, 500, error instanceof Error ? error.message : String(error), "server_error");
		} finally {
			req.off("close", onClose);
		}
		return;
	}

	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		log("rejecting request because messages is empty");
		sendOpenAiError(res, 400, "`messages` must be a non-empty array.");
		return;
	}

	const resolvedModel = await resolveModel(body.model, body.model_proxy);
	if (body.model && !resolvedModel) {
		log("requested model not found", { requestedModel: body.model });
		sendOpenAiError(res, 400, `Configured local model not found: ${body.model}`, "invalid_model", "model_not_found");
		return;
	}

	let prepared: ParsedOpenAiRequest;
	try {
		prepared = await parseMessages(body.messages, body.tools);
	} catch (error) {
		log("failed to normalize openai messages", error instanceof Error ? error.message : String(error));
		sendOpenAiError(res, 400, error instanceof Error ? error.message : String(error));
		return;
	}

	log("messages normalized", {
		systemPromptLength: prepared.systemPrompt.length,
		llmMessageCount: prepared.llmMessages.length,
		agentHistoryCount: prepared.agentHistory.length,
		canUseAgentSession: prepared.canUseAgentSession,
		requiresDirectModelCall: prepared.requiresDirectModelCall,
		webSearchEnabled: body.web_search_enabled === true,
		webSearchLimit: normalizeWebSearchLimit(body.web_search_limit, 40),
	});

	const { session, cacheKey, isReusable, isNewSession } = await getOrCreateSessionForRequest(body, resolvedModel);
	log("agent session created", {
		sessionId: session.sessionId,
		cacheKey: cacheKey ?? null,
		isReusable,
		isNewSession,
		requestedModel: body.model ?? null,
		initialModel: session.model ? `${session.model.provider}/${session.model.id}` : null,
		activeTools: session.getActiveToolNames(),
	});

	session.agent.state.systemPrompt =
		upsertWebSearchPrompt(
			session.agent.state.systemPrompt,
			body.web_search_profile,
			body.web_search_enabled === true,
		) ?? "";

	if (prepared.agentHistory.length > 0 && (!isReusable || isNewSession || session.messages.length === 0)) {
		session.agent.state.messages = prepared.agentHistory;
		log("history restored into session", {
			historyCount: prepared.agentHistory.length,
		});
	}

	if (prepared.systemPrompt && (!isReusable || isNewSession || !session.agent.state.systemPrompt)) {
		session.agent.state.systemPrompt =
			mergeSystemPrompt(session.agent.state.systemPrompt, prepared.systemPrompt) ?? "";
	}

	const effectiveModel = session.model;
	if (!effectiveModel) {
		log("no effective model available after session creation");
		if (!cacheKey) {
			session.dispose();
		} else {
			disposeCachedSession(cacheKey);
		}
		sendOpenAiError(res, 500, "No local PI model is available. Please configure a model first.", "server_error");
		return;
	}

	const responseModel = `${effectiveModel.provider}/${effectiveModel.id}`;
	const completionId = `chatcmpl-${randomUUID()}`;
	const toolStatusSignatureById = new Map<string, string>();
	const activityLogger = createActivityLogger(completionId, startedAt);
	const traceLogger = createTraceLogger(completionId, startedAt);
	let clientClosed = false;
	log("starting generation", {
		completionId,
		responseModel,
		stream: body.stream === true,
		path: prepared.requiresDirectModelCall ? "direct-model" : "agent-session",
	});
	traceLogger.trace("request.start_generation", {
		responseModel,
		stream: body.stream === true,
		path: prepared.requiresDirectModelCall ? "direct-model" : "agent-session",
		systemPromptLength: prepared.systemPrompt.length,
		agentHistoryCount: prepared.agentHistory.length,
		llmMessageCount: prepared.llmMessages.length,
		cacheKey: cacheKey ?? null,
		isReusable,
		isNewSession,
	});

	const abortOnClose = () => {
		clientClosed = true;
		log("client connection closed, aborting session", { completionId });
		activityLogger.mark("client_close");
		traceLogger.trace("connection.client_close", { path: "agent-session" });
		void session.abort().then(
			() => {
				log("session abort completed after client close", { completionId });
				traceLogger.trace("connection.client_close.abort_completed", {
					path: "agent-session",
				});
			},
			(error) => {
				log("session abort failed after client close", {
					completionId,
					error: error instanceof Error ? error.message : String(error),
				});
				traceLogger.trace("connection.client_close.abort_failed", {
					error: error instanceof Error ? error.message : String(error),
					path: "agent-session",
				});
			},
		);
	};
	req.on("close", abortOnClose);

	try {
		if (prepared.requiresDirectModelCall) {
			await runDirectModelRequest({
				session,
				prepared,
				request: body,
				req,
				res,
				completionId,
				responseModel,
				startedAt,
				activityLogger,
				traceLogger,
			});
			return;
		}

		if (!prepared.prompt?.trim()) {
			activityLogger.mark("empty_prompt");
			traceLogger.trace("request.empty_prompt");
			sendOpenAiError(res, 400, "The final user message must contain text content.");
			return;
		}

		if (body.stream) {
			setCorsHeaders(res);
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache, no-transform");
			res.setHeader("Connection", "keep-alive");

			writeSseChunk(res, {
				id: completionId,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: responseModel,
				service_tier: "default",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
				usage: null,
			});

			const unsubscribe = session.subscribe((event) => {
				activityLogger.mark(
					event.type === "message_update" ? `message_update:${event.assistantMessageEvent.type}` : event.type,
				);
				const traceLabel =
					event.type === "message_update"
						? `agent-stream.message_update.${event.assistantMessageEvent.type}`
						: `agent-stream.${event.type}`;
				traceLogger.trace(traceLabel, summarizeAgentEvent(event));
				if (event.type === "agent_start") {
					activityLogger.record("agentStarts");
					log("agent_start", { completionId });
				}
				if (event.type === "message_end") {
					activityLogger.record("otherEvents");
				}
				if (event.type === "tool_execution_start") {
					activityLogger.record("toolStarts");
					log("tool_execution_start", {
						completionId,
						toolName: event.toolName,
						toolCallId: event.toolCallId,
					});
					toolStatusSignatureById.delete(event.toolCallId);
					const argsPreview = buildArgsPreview(event.args);
					emitToolExecutionChunk({
						res,
						completionId,
						responseModel,
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						event: "start",
						phase: "executing",
						extra: argsPreview
							? {
									args_preview: argsPreview,
								}
							: undefined,
					});
				}
				if (event.type === "tool_execution_update") {
					activityLogger.record("toolUpdates");
					const argsPreview = buildArgsPreview(event.args);
					const resultPreview = toToolPreviewText(event.partialResult);
					const signature = JSON.stringify({
						event: "update",
						phase: "executing",
						argsPreview,
						resultPreview,
					});
					if (toolStatusSignatureById.get(event.toolCallId) === signature) {
						return;
					}
					toolStatusSignatureById.set(event.toolCallId, signature);
					emitToolExecutionChunk({
						res,
						completionId,
						responseModel,
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						event: "update",
						phase: "executing",
						extra: {
							...(argsPreview ? { args_preview: argsPreview } : {}),
							...(resultPreview ? { result_preview: resultPreview } : {}),
						},
					});
				}
				if (event.type === "tool_execution_end") {
					activityLogger.record("toolEnds");
					log("tool_execution_end", {
						completionId,
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						isError: event.isError,
					});
					const resultPreview = toToolPreviewText(event.result);
					const signature = JSON.stringify({
						event: "end",
						phase: "completed",
						isError: event.isError,
						resultPreview,
					});
					toolStatusSignatureById.set(event.toolCallId, signature);
					emitToolExecutionChunk({
						res,
						completionId,
						responseModel,
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						event: "end",
						phase: "completed",
						extra: {
							is_error: event.isError,
							...(resultPreview ? { result_preview: resultPreview } : {}),
						},
					});
					if (event.toolName === "web_search" && !event.isError) {
						const items = extractWebSearchResultItems(event.result);
						if (items.length > 0) {
							writeSseChunk(res, {
								id: completionId,
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: responseModel,
								service_tier: "default",
								choices: [
									{
										index: 0,
										delta: {
											network_search_result: toNetworkSearchResultPayload(items),
										},
										finish_reason: null,
									},
								],
								usage: null,
							});
						}
					}
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_start") {
					activityLogger.record("toolCallStarts");
					const toolCallSnapshot = getToolCallSnapshot({
						contentIndex: event.assistantMessageEvent.contentIndex,
						partial: event.assistantMessageEvent.partial,
					});
					if (toolCallSnapshot) {
						const argsPreview = buildArgsPreview(toolCallSnapshot.args);
						const signature = JSON.stringify({
							event: "start",
							phase: "assembling",
							argsPreview,
						});
						if (toolStatusSignatureById.get(toolCallSnapshot.toolCallId) === signature) {
							return;
						}
						toolStatusSignatureById.set(toolCallSnapshot.toolCallId, signature);
						emitToolExecutionChunk({
							res,
							completionId,
							responseModel,
							toolName: toolCallSnapshot.toolName,
							toolCallId: toolCallSnapshot.toolCallId,
							event: "start",
							phase: "assembling",
							extra: argsPreview
								? {
										args_preview: argsPreview,
									}
								: undefined,
						});
					}
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_delta") {
					activityLogger.record("toolCallDeltas");
					const toolCallSnapshot = getToolCallSnapshot({
						contentIndex: event.assistantMessageEvent.contentIndex,
						partial: event.assistantMessageEvent.partial,
					});
					if (toolCallSnapshot) {
						const argsPreview = buildArgsPreview(toolCallSnapshot.args);
						const signature = JSON.stringify({
							event: "update",
							phase: "assembling",
							argsPreview,
						});
						if (toolStatusSignatureById.get(toolCallSnapshot.toolCallId) === signature) {
							return;
						}
						toolStatusSignatureById.set(toolCallSnapshot.toolCallId, signature);
						emitToolExecutionChunk({
							res,
							completionId,
							responseModel,
							toolName: toolCallSnapshot.toolName,
							toolCallId: toolCallSnapshot.toolCallId,
							event: "update",
							phase: "assembling",
							extra: argsPreview
								? {
										args_preview: argsPreview,
									}
								: undefined,
						});
					}
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_end") {
					activityLogger.record("toolCallEnds");
					const toolCallSnapshot = getToolCallSnapshot({
						contentIndex: event.assistantMessageEvent.contentIndex,
						partial: event.assistantMessageEvent.partial,
						toolCall: event.assistantMessageEvent.toolCall,
					});
					if (toolCallSnapshot) {
						const argsPreview = buildArgsPreview(toolCallSnapshot.args);
						const signature = JSON.stringify({
							event: "update",
							phase: "assembling",
							argsComplete: true,
							argsPreview,
						});
						if (toolStatusSignatureById.get(toolCallSnapshot.toolCallId) === signature) {
							return;
						}
						toolStatusSignatureById.set(toolCallSnapshot.toolCallId, signature);
						emitToolExecutionChunk({
							res,
							completionId,
							responseModel,
							toolName: toolCallSnapshot.toolName,
							toolCallId: toolCallSnapshot.toolCallId,
							event: "update",
							phase: "assembling",
							extra: {
								args_complete: true,
								...(argsPreview ? { args_preview: argsPreview } : {}),
							},
						});
					}
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					activityLogger.record("textDeltas");
					writeSseChunk(res, {
						id: completionId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: responseModel,
						service_tier: "default",
						choices: [
							{
								index: 0,
								delta: { content: event.assistantMessageEvent.delta },
								finish_reason: null,
							},
						],
						usage: null,
					});
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
					activityLogger.record("thinkingDeltas");
					writeSseChunk(res, {
						id: completionId,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: responseModel,
						service_tier: "default",
						choices: [
							{
								index: 0,
								delta: {
									content: "",
									reasoning_content: event.assistantMessageEvent.delta,
								},
								finish_reason: null,
							},
						],
						usage: null,
					});
				}
				if (
					event.type === "message_update" &&
					event.assistantMessageEvent.type !== "text_delta" &&
					event.assistantMessageEvent.type !== "thinking_delta" &&
					event.assistantMessageEvent.type !== "toolcall_start" &&
					event.assistantMessageEvent.type !== "toolcall_delta" &&
					event.assistantMessageEvent.type !== "toolcall_end"
				) {
					activityLogger.record("otherEvents");
				}
				if (event.type === "agent_end") {
					activityLogger.record("agentEnds");
				}
			});

			await session.prompt(prepared.prompt);
			activityLogger.mark("streaming_prompt_resolved");
			traceLogger.trace("agent-stream.prompt_resolved", {
				messageCount: session.messages.length,
				lastAssistant: summarizeAgentMessage(findLastAssistant(session.messages)),
			});
			log("streaming prompt resolved", {
				completionId,
				elapsedMs: Date.now() - startedAt,
			});

			if (clientClosed || !isResponseWritable(res)) {
				traceLogger.trace("agent-stream.finish.client_closed");
				return;
			}

			const assistant = findLastAssistant(session.messages);
			if (assistant?.stopReason === "error" && assistant.errorMessage) {
				unsubscribe();
				writeSseChunk(res, {
					error: {
						message: assistant.errorMessage,
						type: "server_error",
						code: "pi_generation_error",
					},
				});
				if (isResponseWritable(res)) {
					res.write("data: [DONE]\n\n");
				}
				activityLogger.stop();
				endSseStream(res);
				traceLogger.trace("agent-stream.finish.error");
				return;
			}

			writeSseChunk(res, {
				id: completionId,
				object: "chat.completion.chunk",
				created: Math.floor(Date.now() / 1000),
				model: responseModel,
				service_tier: "default",
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: mapFinishReason(assistant?.stopReason),
					},
				],
				usage: null,
			});
			if (isResponseWritable(res)) {
				res.write("data: [DONE]\n\n");
			}
			unsubscribe();
			activityLogger.stop();
			endSseStream(res);
			traceLogger.trace("agent-stream.finish.success", {
				finishReason: mapFinishReason(assistant?.stopReason),
				messageCount: session.messages.length,
			});
			log("streaming response completed", {
				completionId,
				finishReason: mapFinishReason(assistant?.stopReason),
				elapsedMs: Date.now() - startedAt,
			});
			return;
		}

		const unsubscribe = session.subscribe((event) => {
			activityLogger.mark(
				event.type === "message_update" ? `message_update:${event.assistantMessageEvent.type}` : event.type,
			);
			const traceLabel =
				event.type === "message_update"
					? `agent-sync.message_update.${event.assistantMessageEvent.type}`
					: `agent-sync.${event.type}`;
			traceLogger.trace(traceLabel, summarizeAgentEvent(event));
			if (event.type === "agent_start") {
				activityLogger.record("agentStarts");
				log("agent_start", { completionId });
			}
			if (event.type === "turn_start") {
				activityLogger.record("otherEvents");
				log("turn_start", { completionId });
			}
			if (event.type === "tool_execution_start") {
				activityLogger.record("toolStarts");
				log("tool_execution_start", {
					completionId,
					toolName: event.toolName,
					toolCallId: event.toolCallId,
				});
			}
			if (event.type === "tool_execution_end") {
				activityLogger.record("toolEnds");
				log("tool_execution_end", {
					completionId,
					toolName: event.toolName,
					toolCallId: event.toolCallId,
					isError: event.isError,
				});
			}
			if (event.type === "agent_end") {
				activityLogger.record("agentEnds");
				log("agent_end", { completionId, elapsedMs: Date.now() - startedAt });
			}
			if (event.type === "message_end") {
				activityLogger.record("otherEvents");
			}
			if (event.type === "message_update") {
				if (event.assistantMessageEvent.type === "text_delta") {
					activityLogger.record("textDeltas");
				} else if (event.assistantMessageEvent.type === "thinking_delta") {
					activityLogger.record("thinkingDeltas");
				} else if (event.assistantMessageEvent.type === "toolcall_start") {
					activityLogger.record("toolCallStarts");
				} else if (event.assistantMessageEvent.type === "toolcall_delta") {
					activityLogger.record("toolCallDeltas");
				} else if (event.assistantMessageEvent.type === "toolcall_end") {
					activityLogger.record("toolCallEnds");
				} else {
					activityLogger.record("otherEvents");
				}
			}
		});

		await session.prompt(prepared.prompt);
		activityLogger.mark("non_stream_prompt_resolved");
		traceLogger.trace("agent-sync.prompt_resolved", {
			messageCount: session.messages.length,
			lastAssistant: summarizeAgentMessage(findLastAssistant(session.messages)),
		});
		unsubscribe();
		activityLogger.stop();
		const assistant = findLastAssistant(session.messages);
		if (assistant?.stopReason === "error" && assistant.errorMessage) {
			log("assistant returned error", {
				completionId,
				errorMessage: assistant.errorMessage,
				elapsedMs: Date.now() - startedAt,
			});
			sendOpenAiError(res, 500, assistant.errorMessage, "server_error", "pi_generation_error");
			return;
		}

		log("returning non-stream response", {
			completionId,
			finishReason: mapFinishReason(assistant?.stopReason),
			elapsedMs: Date.now() - startedAt,
		});
		traceLogger.trace("agent-sync.finish.success", {
			finishReason: mapFinishReason(assistant?.stopReason),
			messageCount: session.messages.length,
		});
		sendJson(res, 200, buildChatCompletionResponse(completionId, responseModel, assistant));
	} catch (error) {
		activityLogger.mark("exception");
		traceLogger.trace("request.exception", {
			error: error instanceof Error ? error.message : String(error),
			clientClosed,
			headersSent: res.headersSent,
			writableEnded: res.writableEnded,
			destroyed: res.destroyed,
		});
		log("request failed with exception", {
			completionId,
			error: error instanceof Error ? error.message : String(error),
			elapsedMs: Date.now() - startedAt,
			clientClosed,
			headersSent: res.headersSent,
			writableEnded: res.writableEnded,
			destroyed: res.destroyed,
		});
		if (clientClosed || !isResponseWritable(res) || res.headersSent) {
			traceLogger.trace("request.exception.response_skipped", {
				reason: clientClosed ? "client_closed" : "response_not_writable",
			});
		} else {
			sendOpenAiError(res, 500, error instanceof Error ? error.message : String(error), "server_error");
		}
	} finally {
		activityLogger.stop();
		req.off("close", abortOnClose);
		if (cacheKey) {
			const entry = sessionCache.get(cacheKey);
			if (entry) {
				entry.lastUsedAt = Date.now();
			}
			log("cached session retained", {
				completionId,
				cacheKey,
				elapsedMs: Date.now() - startedAt,
			});
			traceLogger.trace("session.cache_retained", { cacheKey });
		} else {
			session.dispose();
			log("session disposed", {
				completionId,
				elapsedMs: Date.now() - startedAt,
			});
			traceLogger.trace("session.disposed");
		}
		traceLogger.trace("request.finish");
	}
}

async function handleModels(res: ServerResponse) {
	const models = modelRegistry.getAvailable().map((model) => ({
		id: `${model.provider}/${model.id}`,
		object: "model",
		created: 0,
		owned_by: model.provider,
	}));

	sendJson(res, 200, {
		object: "list",
		data: models,
	});
}

async function handleAbortSession(req: IncomingMessage, res: ServerResponse) {
	let body: AbortSessionRequest;
	try {
		body = (await readJsonBody(req)) as AbortSessionRequest;
	} catch (error) {
		log("failed to parse abort session request body", error instanceof Error ? error.message : String(error));
		sendOpenAiError(res, 400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	const cacheKey = getSessionCacheKey(body);
	if (!cacheKey) {
		sendOpenAiError(res, 400, "Either `session_id` or `conversation_id` is required.");
		return;
	}

	const startedAt = Date.now();
	log("received session abort request", { cacheKey });

	try {
		const aborted = await abortCachedSession(cacheKey);
		sendJson(res, 200, {
			aborted,
			elapsedMs: Date.now() - startedAt,
			session_id: cacheKey,
			success: true,
		});
		return;
	} catch (error) {
		log("failed to abort cached session", {
			cacheKey,
			error: error instanceof Error ? error.message : String(error),
		});
		sendOpenAiError(res, 500, error instanceof Error ? error.message : String(error), "server_error", "abort_failed");
	}
}

async function handleArtifactList(req: IncomingMessage, res: ServerResponse) {
	let body: ArtifactListRequest;
	try {
		body = (await readJsonBody(req)) as ArtifactListRequest;
	} catch (error) {
		sendOpenAiError(res, 400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	try {
		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: body.workspace_dir,
			workspaceRoot,
		});
		sendJson(res, 200, {
			group_id: body.group_id ?? null,
			success: true,
			...manifest,
		});
	} catch (error) {
		sendOpenAiError(
			res,
			400,
			error instanceof Error ? error.message : String(error),
			"invalid_request_error",
			"artifact_list_failed",
		);
	}
}

async function handleArtifactRead(req: IncomingMessage, res: ServerResponse) {
	let body: ArtifactReadRequest;
	try {
		body = (await readJsonBody(req)) as ArtifactReadRequest;
	} catch (error) {
		sendOpenAiError(res, 400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	try {
		const artifactPath = resolveArtifactFilePath({
			path: body.path,
			rawWorkspaceDir: body.workspace_dir,
			workspaceRoot,
			runId: body.run_id,
		});
		const stat = await fs.stat(artifactPath);
		const byteLimit = 512 * 1024;
		const fileBuffer = await fs.readFile(artifactPath);
		const truncated = fileBuffer.length > byteLimit;
		const visibleBuffer = truncated ? fileBuffer.subarray(0, byteLimit) : fileBuffer;
		const fileName = artifactPath.split("/").pop() ?? artifactPath;

		sendJson(res, 200, {
			content: visibleBuffer.toString("utf8"),
			path: body.path,
			run_id: body.run_id,
			size: stat.size,
			success: true,
			truncated,
			type: guessArtifactFileType(fileName),
			updatedAt: stat.mtime.toISOString(),
			workspaceDir: resolveWorkspaceDir({
				rawWorkspaceDir: body.workspace_dir,
				workspaceRoot,
			}),
		});
	} catch (error) {
		sendOpenAiError(
			res,
			400,
			error instanceof Error ? error.message : String(error),
			"invalid_request_error",
			"artifact_read_failed",
		);
	}
}

async function handleArtifactRewrite(req: IncomingMessage, res: ServerResponse) {
	let body: ArtifactRewriteRequest;
	try {
		body = (await readJsonBody(req)) as ArtifactRewriteRequest;
	} catch (error) {
		sendOpenAiError(res, 400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	if (typeof body.content !== "string") {
		sendOpenAiError(
			res,
			400,
			"Artifact rewrite requires string content.",
			"invalid_request_error",
			"artifact_rewrite_failed",
		);
		return;
	}

	try {
		const artifactPath = resolveArtifactFilePath({
			path: body.path,
			rawWorkspaceDir: body.workspace_dir,
			workspaceRoot,
			runId: body.run_id,
		});
		await fs.mkdir(dirname(artifactPath), { recursive: true });
		await fs.writeFile(artifactPath, body.content, "utf8");
		const stat = await fs.stat(artifactPath);
		const fileName = artifactPath.split("/").pop() ?? artifactPath;

		sendJson(res, 200, {
			path: body.path,
			run_id: body.run_id,
			size: stat.size,
			success: true,
			type: guessArtifactFileType(fileName),
			updatedAt: stat.mtime.toISOString(),
			workspaceDir: resolveWorkspaceDir({
				rawWorkspaceDir: body.workspace_dir,
				workspaceRoot,
			}),
		});
	} catch (error) {
		sendOpenAiError(
			res,
			400,
			error instanceof Error ? error.message : String(error),
			"invalid_request_error",
			"artifact_rewrite_failed",
		);
	}
}

const server = createServer(async (req, res) => {
	setCorsHeaders(res);

	if (!req.url || !req.method) {
		sendOpenAiError(res, 404, "Not found.", "not_found_error");
		return;
	}

	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}

	if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
		sendJson(res, 200, { ok: true });
		return;
	}

	if (req.method === "GET" && req.url === "/v1/models") {
		await handleModels(res);
		return;
	}

	if (req.method === "POST" && req.url === "/v1/chat/completions") {
		await handleChatCompletions(req, res);
		return;
	}

	if (req.method === "POST" && req.url === "/v1/chat/sessions/abort") {
		await handleAbortSession(req, res);
		return;
	}

	if (req.method === "POST" && req.url === "/v1/artifacts/list") {
		await handleArtifactList(req, res);
		return;
	}

	if (req.method === "POST" && req.url === "/v1/artifacts/read") {
		await handleArtifactRead(req, res);
		return;
	}

	if (req.method === "POST" && req.url === "/v1/artifacts/rewrite") {
		await handleArtifactRewrite(req, res);
		return;
	}

	sendOpenAiError(res, 404, "Not found.", "not_found_error");
});

server.listen(port, () => {
	log(`server listening on http://localhost:${port}`);
	log(`cwd=${cwd}`);
	log(`tools=${toolsMode}`);
});
