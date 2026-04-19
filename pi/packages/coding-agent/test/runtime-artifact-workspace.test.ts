import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArtifactManifest, resolveArtifactFilePath } from "../src/runtime/artifact-workspace.js";

const tempDirs: string[] = [];

async function createTempWorkspace() {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "artifact-workspace-"));
	tempDirs.push(workspaceRoot);
	return workspaceRoot;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0, tempDirs.length).map((target) => rm(target, { force: true, recursive: true })));
});

describe("runtime artifact workspace", () => {
	it("uses the data directory as the logical root when it exists", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "41");
		const runDir = join(conversationDir, "data", "20260414_150200_group41-smoke");

		await mkdir(join(runDir, "research", "wiki"), { recursive: true });
		await writeFile(join(runDir, "research", "wiki", "index.md"), "# index", "utf8");
		await writeFile(join(conversationDir, "simple_game.html"), "<html></html>", "utf8");

		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: "conversations/41",
			workspaceRoot,
		});

		expect(manifest.workspaceRootMode).toBe("data");
		expect(manifest.workspaceDir).toBe(join(conversationDir, "data"));
		expect(manifest.runs).toHaveLength(1);
		expect(manifest.workspaceFiles.map((file) => file.path)).toEqual([
			"20260414_150200_group41-smoke/research/wiki/index.md",
		]);
		expect(manifest.workspaceTree).toEqual([
			expect.objectContaining({
				children: [
					expect.objectContaining({
						children: [
							expect.objectContaining({
								children: [
									expect.objectContaining({
										name: "index.md",
										nodeType: "file",
										path: "20260414_150200_group41-smoke/research/wiki/index.md",
										runId: "20260414_150200_group41-smoke",
										source: "artifacts_root",
									}),
								],
								name: "wiki",
								nodeType: "directory",
								path: "20260414_150200_group41-smoke/research/wiki",
							}),
						],
						name: "research",
						nodeType: "directory",
						path: "20260414_150200_group41-smoke/research",
					}),
				],
				name: "20260414_150200_group41-smoke",
				nodeType: "directory",
				path: "20260414_150200_group41-smoke",
			}),
		]);
		expect(manifest.workspaceFiles[0]).toMatchObject({
			runId: "20260414_150200_group41-smoke",
			source: "artifacts_root",
			type: "markdown",
		});
	});

	it("resolves loose workspace files without requiring runId", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "41");

		await mkdir(conversationDir, { recursive: true });
		await writeFile(join(conversationDir, "simple_game.html"), "<html></html>", "utf8");

		const resolved = resolveArtifactFilePath({
			path: "simple_game.html",
			rawWorkspaceDir: "conversations/41",
			workspaceRoot,
		});

		expect(resolved).toBe(join(conversationDir, "simple_game.html"));
	});

	it("resolves nested files relative to the data directory root", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "77");

		await mkdir(join(conversationDir, "data", "20260415_071116_topic", "research"), {
			recursive: true,
		});
		await writeFile(join(conversationDir, "data", "20260415_071116_topic", "research", "wiki.md"), "# wiki", "utf8");

		const resolved = resolveArtifactFilePath({
			path: "20260415_071116_topic/research/wiki.md",
			rawWorkspaceDir: "conversations/77",
			workspaceRoot,
		});

		expect(resolved).toBe(join(conversationDir, "data", "20260415_071116_topic", "research", "wiki.md"));
	});

	it("falls back to the conversation directory when no data directory exists", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "88");

		await mkdir(join(conversationDir, "drafts"), { recursive: true });
		await writeFile(join(conversationDir, "drafts", "outline.md"), "# outline", "utf8");

		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: "conversations/88",
			workspaceRoot,
		});

		expect(manifest.workspaceRootMode).toBe("conversation");
		expect(manifest.workspaceDir).toBe(conversationDir);
		expect(manifest.workspaceFiles.map((file) => file.path)).toEqual(["drafts/outline.md"]);
		expect(manifest.workspaceTree).toEqual([
			expect.objectContaining({
				children: [
					expect.objectContaining({
						name: "outline.md",
						nodeType: "file",
						path: "drafts/outline.md",
						source: "workspace_loose",
					}),
				],
				name: "drafts",
				nodeType: "directory",
				path: "drafts",
			}),
		]);
	});

	it("keeps markdown preview structure for inline rendering", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "42");

		await mkdir(conversationDir, { recursive: true });
		await writeFile(join(conversationDir, "intro.md"), "# 标题\n\n## 小节\n\n- 第一条\n- 第二条", "utf8");

		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: "conversations/42",
			workspaceRoot,
		});

		expect(manifest.workspaceFiles[0]?.preview).toContain("\n\n## 小节\n\n- 第一条");
	});

	it("returns an empty manifest when the conversation workspace does not exist yet", async () => {
		const workspaceRoot = await createTempWorkspace();

		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: "conversations/100",
			workspaceRoot,
		});

		expect(manifest.workspaceRootMode).toBe("conversation");
		expect(manifest.workspaceDir).toBe(join(workspaceRoot, "conversations", "100"));
		expect(manifest.runs).toEqual([]);
		expect(manifest.workspaceFiles).toEqual([]);
		expect(manifest.workspaceTree).toEqual([]);
	});
});
