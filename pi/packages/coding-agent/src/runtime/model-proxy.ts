import type { Api, Model } from "@mariozechner/pi-ai";

export interface RequestScopedModelProxyConfig {
	apiKey: string;
	baseUrl: string;
	contextWindow?: number;
	maxTokens?: number;
	model: string;
}

type RequestScopedModel = Model<"openai-completions"> & {
	provider: "openwork-service-proxy";
};

const requestScopedAuth = new WeakMap<Model<Api>, string>();

export function buildRequestScopedModelProxy(config: RequestScopedModelProxyConfig): Model<"openai-completions"> {
	const contextWindow = resolvePositiveNumber(config.contextWindow, 128000);
	const maxTokens = resolvePositiveNumber(config.maxTokens, 8192);
	const model: RequestScopedModel = {
		api: "openai-completions",
		baseUrl: config.baseUrl.replace(/\/+$/, ""),
		compat: {
			maxTokensField: "max_tokens",
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsStore: false,
			supportsStrictMode: false,
			supportsUsageInStreaming: true,
		},
		contextWindow,
		cost: {
			cacheRead: 0,
			cacheWrite: 0,
			input: 0,
			output: 0,
		},
		id: config.model,
		input: ["text", "image"],
		maxTokens,
		name: `OpenWork Admin Model (${config.model})`,
		provider: "openwork-service-proxy",
		reasoning: false,
	};

	requestScopedAuth.set(model, config.apiKey);
	return model;
}

function resolvePositiveNumber(value: unknown, fallback: number) {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function getRequestScopedModelAuth(model: Model<Api>) {
	const apiKey = requestScopedAuth.get(model);
	if (!apiKey) {
		return undefined;
	}
	return { ok: true as const, apiKey, headers: undefined };
}

export function hasRequestScopedModelProxy(model: Model<Api> | undefined): boolean {
	return Boolean(model && requestScopedAuth.has(model));
}

export function shouldReuseSessionForRequestScopedModel(model: Model<Api> | undefined): boolean {
	return !hasRequestScopedModelProxy(model);
}
