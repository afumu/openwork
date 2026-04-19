import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArtifactManifest, resolveArtifactFilePath } from "./artifactWorkspace.js";

const tempDirs: string[] = [];

async function createTempWorkspace() {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "artifact-workspace-"));
	tempDirs.push(workspaceRoot);
	return workspaceRoot;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0, tempDirs.length).map((target) => rm(target, { force: true, recursive: true })));
});

describe("artifactWorkspace", () => {
	it("lists both run artifacts and loose workspace files for a conversation", async () => {
		const workspaceRoot = await createTempWorkspace();
		const conversationDir = join(workspaceRoot, "conversations", "41");
		const runDir = join(conversationDir, "data", "20260414_150200_group41-smoke");

		await mkdir(runDir, { recursive: true });
		await writeFile(join(runDir, "00_index.md"), "# index", "utf8");
		await writeFile(join(conversationDir, "simple_game.html"), "<html></html>", "utf8");

		const manifest = await buildArtifactManifest({
			rawWorkspaceDir: "conversations/41",
			workspaceRoot,
		});

		expect(manifest.runs).toHaveLength(1);
		expect(manifest.workspaceFiles.map((file) => file.path)).toEqual([
			"simple_game.html",
			"data/20260414_150200_group41-smoke/00_index.md",
		]);

		const looseFile = manifest.workspaceFiles.find((file) => file.path === "simple_game.html");
		expect(looseFile).toMatchObject({
			runId: null,
			source: "workspace_loose",
			type: "html",
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
});
