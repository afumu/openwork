import { describe, expect, it } from "vitest";
import {
	buildRequestScopedModelProxy,
	getRequestScopedModelAuth,
	hasRequestScopedModelProxy,
	shouldReuseSessionForRequestScopedModel,
} from "../src/runtime/model-proxy.js";

describe("request scoped model proxy", () => {
	it("builds an in-memory OpenAI-compatible model without persisting provider keys", () => {
		const model = buildRequestScopedModelProxy({
			apiKey: "run-token",
			baseUrl: "http://host.docker.internal:9520/api/chatgpt/internal/model-proxy/v1",
			model: "gpt-5.2",
		});

		expect(model).toMatchObject({
			api: "openai-completions",
			baseUrl: "http://host.docker.internal:9520/api/chatgpt/internal/model-proxy/v1",
			id: "gpt-5.2",
			name: "OpenWork Admin Model (gpt-5.2)",
			provider: "openwork-service-proxy",
		});
		expect(JSON.stringify(model)).not.toContain("run-token");
		expect(getRequestScopedModelAuth(model)).toEqual({ ok: true, apiKey: "run-token" });
	});

	it("marks request-scoped models as non-reusable so expired run tokens are not cached", () => {
		const model = buildRequestScopedModelProxy({
			apiKey: "short-lived-token",
			baseUrl: "http://host.docker.internal:9520/api/chatgpt/internal/model-proxy/v1",
			model: "gpt-4o",
		});

		expect(hasRequestScopedModelProxy(model)).toBe(true);
		expect(shouldReuseSessionForRequestScopedModel(model)).toBe(false);
	});

	it("uses backend-provided token limits when available", () => {
		const model = buildRequestScopedModelProxy({
			apiKey: "run-token",
			baseUrl: "http://host.docker.internal:9520/api/chatgpt/internal/model-proxy/v1",
			contextWindow: 64000,
			maxTokens: 4096,
			model: "gpt-5.3-codex",
		});

		expect(model.contextWindow).toBe(64000);
		expect(model.maxTokens).toBe(4096);
	});
});
