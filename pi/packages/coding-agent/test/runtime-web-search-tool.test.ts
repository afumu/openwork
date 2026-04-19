import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWebSearchTool } from "../src/runtime/web-search-tool.js";

type TestRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

function listenOnce(handler: TestRequestHandler): Promise<{ url: string; close: () => Promise<void> }> {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			void handler(req, res);
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Failed to resolve test server address"));
				return;
			}
			resolve({
				url: `http://127.0.0.1:${address.port}/internal/search`,
				close: () =>
					new Promise<void>((closeResolve, closeReject) => {
						server.close((error) => (error ? closeReject(error) : closeResolve()));
					}),
			});
		});
		server.on("error", reject);
	});
}

describe("createWebSearchTool", () => {
	const disposers: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (disposers.length) {
			await disposers.pop()?.();
		}
	});

	it("fetches search results through the host internal search bridge", async () => {
		let requestedBody: unknown;
		let requestedMethod = "";
		let requestedToken: string | string[] | undefined;
		const listener = await listenOnce(async (req, res) => {
			requestedMethod = req.method || "";
			requestedToken = req.headers["x-openwork-internal-token"];

			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += String(chunk);
			});
			req.on("end", () => {
				requestedBody = JSON.parse(body);
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify({
						code: 200,
						success: true,
						data: {
							items: [
								{
									title: "Trump latest story",
									summary: "A recent news summary",
									link: "https://example.com/trump",
									source: "Example",
									time: "2026-04-15",
								},
							],
						},
					}),
				);
			});
		});
		disposers.push(listener.close);

		const tool = createWebSearchTool({
			url: listener.url,
			token: "internal-token",
			defaultLimit: 40,
		});

		const result = await tool.execute("search-1", { query: "Trump latest news", limit: 10 });

		expect(requestedMethod).toBe("POST");
		expect(requestedToken).toBe("internal-token");
		expect(requestedBody).toEqual({ topic: "Trump latest news", limit: 10 });
		expect(result.details?.items).toHaveLength(1);
		expect(result.details?.items[0]?.title).toBe("Trump latest story");
		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type !== "text") {
			throw new Error("Expected text content");
		}
		expect(firstContent.text).toContain("Trump latest story");
	});

	it("honors a smaller requested limit and keeps formatted summaries compact", async () => {
		const longSummary = "x".repeat(800);
		let requestedBody: unknown;
		const listener = await listenOnce(async (req, res) => {
			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += String(chunk);
			});
			req.on("end", () => {
				requestedBody = JSON.parse(body);
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify({
						data: {
							items: Array.from({ length: 5 }, (_, index) => ({
								title: `Result ${index + 1}`,
								summary: longSummary,
								link: `https://example.com/${index + 1}`,
								source: "Example",
							})),
						},
					}),
				);
			});
		});
		disposers.push(listener.close);

		const tool = createWebSearchTool({
			url: listener.url,
			token: "internal-token",
			defaultLimit: 8,
		});

		const result = await tool.execute("search-2", { query: "OpenAI enterprise agent news", limit: 3 });

		expect(requestedBody).toEqual({ topic: "OpenAI enterprise agent news", limit: 3 });
		expect(result.details?.items).toHaveLength(3);
		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type !== "text") {
			throw new Error("Expected text content");
		}
		expect(firstContent.text).toContain("Result 3");
		expect(firstContent.text).not.toContain("Result 4");
		expect(firstContent.text.length).toBeLessThan(1200);
		expect(firstContent.text).toContain("...");
	});
});
