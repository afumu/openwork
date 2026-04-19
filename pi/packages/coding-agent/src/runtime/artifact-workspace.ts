import { existsSync, promises as fs } from "node:fs";
import { extname, join, resolve as resolvePath } from "node:path";

export type ArtifactRunSource = "artifacts_root" | "workspace_root" | "workspace_loose";
export type ArtifactWorkspaceRootMode = "data" | "conversation";

export interface ArtifactFileItem {
	name: string;
	path: string;
	preview?: string;
	size: number;
	type: string;
	updatedAt: string;
}

export interface ArtifactWorkspaceFileItem extends ArtifactFileItem {
	runId: string | null;
	source: ArtifactRunSource;
}

export interface ArtifactWorkspaceDirectoryItem {
	children: ArtifactWorkspaceTreeItem[];
	name: string;
	nodeType: "directory";
	path: string;
	updatedAt: string;
}

export interface ArtifactWorkspaceTreeFileItem extends ArtifactWorkspaceFileItem {
	nodeType: "file";
}

export type ArtifactWorkspaceTreeItem = ArtifactWorkspaceDirectoryItem | ArtifactWorkspaceTreeFileItem;

export interface ArtifactRunItem {
	createdAt: string;
	fileCount: number;
	files: ArtifactFileItem[];
	runId: string;
	source: Exclude<ArtifactRunSource, "workspace_loose">;
	updatedAt: string;
}

export interface ArtifactManifest {
	artifactsRoot: string;
	runs: ArtifactRunItem[];
	workspaceDir: string;
	workspaceFiles: ArtifactWorkspaceFileItem[];
	workspaceRootMode: ArtifactWorkspaceRootMode;
	workspaceTree: ArtifactWorkspaceTreeItem[];
}

type BuildArtifactManifestOptions = {
	rawWorkspaceDir?: string;
	workspaceRoot: string;
};

type ResolveArtifactFilePathOptions = BuildArtifactManifestOptions & {
	path?: string;
	runId?: string;
};

type WorkspaceContext = {
	artifactsRoot: string;
	conversationWorkspaceDir: string;
	workspaceDir: string;
	workspaceRootMode: ArtifactWorkspaceRootMode;
};

export function resolveWorkspaceDir(options: BuildArtifactManifestOptions) {
	const candidate = options.rawWorkspaceDir?.trim()
		? resolvePath(options.workspaceRoot, options.rawWorkspaceDir)
		: options.workspaceRoot;

	if (candidate !== options.workspaceRoot && !candidate.startsWith(`${options.workspaceRoot}/`)) {
		throw new Error("Workspace path escapes the configured workspace root.");
	}

	return candidate;
}

function resolveArtifactsRoot(options: BuildArtifactManifestOptions) {
	return join(resolveWorkspaceDir(options), "data");
}

function resolveWorkspaceContext(options: BuildArtifactManifestOptions): WorkspaceContext {
	const conversationWorkspaceDir = resolveWorkspaceDir(options);
	const artifactsRoot = resolveArtifactsRoot(options);
	const workspaceRootMode: ArtifactWorkspaceRootMode = existsSync(artifactsRoot) ? "data" : "conversation";

	return {
		artifactsRoot,
		conversationWorkspaceDir,
		workspaceDir: workspaceRootMode === "data" ? artifactsRoot : conversationWorkspaceDir,
		workspaceRootMode,
	};
}

function isRunDirectoryName(name: string) {
	return /^\d{8}_\d{6}_.+/.test(name);
}

export function guessArtifactFileType(fileName: string) {
	const extension = extname(fileName).toLowerCase();
	if (extension === ".md" || extension === ".markdown") return "markdown";
	if (extension === ".json") return "json";
	if (extension === ".html" || extension === ".htm") return "html";
	if (
		extension === ".txt" ||
		extension === ".log" ||
		extension === ".yaml" ||
		extension === ".yml" ||
		extension === ".css" ||
		extension === ".js" ||
		extension === ".ts"
	) {
		return "text";
	}

	return "unknown";
}

async function pathExists(targetPath: string) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function readArtifactPreview(targetPath: string, maxBytes = 1200, preserveWhitespace = false) {
	const handle = await fs.open(targetPath, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		const preview = buffer.subarray(0, bytesRead).toString("utf8").trim();
		return preserveWhitespace ? preview : preview.replace(/\s+/g, " ");
	} finally {
		await handle.close();
	}
}

async function walkArtifactFiles(currentDir: string, rootDir: string): Promise<ArtifactFileItem[]> {
	const entries = await fs.readdir(currentDir, { withFileTypes: true });
	const files: ArtifactFileItem[] = [];

	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}

		const fullPath = join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkArtifactFiles(fullPath, rootDir)));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		const stat = await fs.stat(fullPath);
		const relativePath = fullPath.slice(rootDir.length + 1);
		const type = guessArtifactFileType(entry.name);
		const preview =
			type === "markdown" || type === "json" || type === "text" || type === "html"
				? await readArtifactPreview(fullPath, type === "markdown" ? 2400 : 1200, type === "markdown").catch(
						() => undefined,
					)
				: undefined;

		files.push({
			name: entry.name,
			path: relativePath,
			preview,
			size: stat.size,
			type,
			updatedAt: stat.mtime.toISOString(),
		});
	}

	return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectRunDirectories(options: BuildArtifactManifestOptions) {
	const { artifactsRoot, conversationWorkspaceDir, workspaceDir, workspaceRootMode } =
		resolveWorkspaceContext(options);
	const runDirs = new Map<
		string,
		{
			runId: string;
			runDir: string;
			source: Exclude<ArtifactRunSource, "workspace_loose">;
		}
	>();

	if (await pathExists(artifactsRoot)) {
		const entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || !isRunDirectoryName(entry.name)) continue;
			runDirs.set(entry.name, {
				runId: entry.name,
				runDir: join(artifactsRoot, entry.name),
				source: "artifacts_root",
			});
		}
	}

	if (await pathExists(conversationWorkspaceDir)) {
		const entries = await fs.readdir(conversationWorkspaceDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || !isRunDirectoryName(entry.name)) continue;
			if (runDirs.has(entry.name)) continue;
			runDirs.set(entry.name, {
				runId: entry.name,
				runDir: join(conversationWorkspaceDir, entry.name),
				source: "workspace_root",
			});
		}
	}

	return {
		artifactsRoot,
		conversationWorkspaceDir,
		runs: [...runDirs.values()],
		workspaceDir,
		workspaceRootMode,
	};
}

function classifyWorkspaceFile(
	relativePath: string,
	runDirectories: Awaited<ReturnType<typeof collectRunDirectories>>["runs"],
	workspaceRootMode: ArtifactWorkspaceRootMode,
): Pick<ArtifactWorkspaceFileItem, "runId" | "source"> {
	for (const run of runDirectories) {
		if (run.source === "artifacts_root") {
			const prefix = workspaceRootMode === "data" ? `${run.runId}/` : `data/${run.runId}/`;
			if (relativePath.startsWith(prefix)) {
				return {
					runId: run.runId,
					source: "artifacts_root",
				};
			}
			continue;
		}

		const prefix = `${run.runId}/`;
		if (relativePath.startsWith(prefix)) {
			return {
				runId: run.runId,
				source: "workspace_root",
			};
		}
	}

	return {
		runId: null,
		source: "workspace_loose",
	};
}

function sortWorkspaceTreeItems(items: ArtifactWorkspaceTreeItem[]) {
	items.sort((left, right) => {
		if (left.nodeType !== right.nodeType) {
			return left.nodeType === "directory" ? -1 : 1;
		}

		return left.name.localeCompare(right.name);
	});

	for (const item of items) {
		if (item.nodeType === "directory") {
			sortWorkspaceTreeItems(item.children);
		}
	}

	return items;
}

function buildWorkspaceTree(files: ArtifactWorkspaceFileItem[]): ArtifactWorkspaceTreeItem[] {
	const root: ArtifactWorkspaceTreeItem[] = [];
	const directoryIndex = new Map<string, ArtifactWorkspaceDirectoryItem>();

	for (const file of files) {
		const segments = file.path.split("/").filter(Boolean);
		let currentChildren = root;
		let currentPath = "";

		for (const segment of segments.slice(0, -1)) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			let directory = directoryIndex.get(currentPath);

			if (!directory) {
				directory = {
					children: [],
					name: segment,
					nodeType: "directory",
					path: currentPath,
					updatedAt: file.updatedAt,
				};
				directoryIndex.set(currentPath, directory);
				currentChildren.push(directory);
			} else if (directory.updatedAt.localeCompare(file.updatedAt) < 0) {
				directory.updatedAt = file.updatedAt;
			}

			currentChildren = directory.children;
		}

		currentChildren.push({
			...file,
			nodeType: "file",
		});
	}

	return sortWorkspaceTreeItems(root);
}

export async function buildArtifactManifest(options: BuildArtifactManifestOptions): Promise<ArtifactManifest> {
	const {
		artifactsRoot,
		runs: runDirectories,
		workspaceDir,
		workspaceRootMode,
	} = await collectRunDirectories(options);
	const runs: ArtifactRunItem[] = [];

	for (const entry of runDirectories) {
		const stat = await fs.stat(entry.runDir);
		const files = await walkArtifactFiles(entry.runDir, entry.runDir);
		runs.push({
			createdAt: stat.birthtime.toISOString(),
			fileCount: files.length,
			files,
			runId: entry.runId,
			source: entry.source,
			updatedAt: stat.mtime.toISOString(),
		});
	}

	const workspaceFiles = (await pathExists(workspaceDir)) ? await walkArtifactFiles(workspaceDir, workspaceDir) : [];
	const enrichedWorkspaceFiles = workspaceFiles.map((file) => ({
		...file,
		...classifyWorkspaceFile(file.path, runDirectories, workspaceRootMode),
	}));
	const workspaceTree = buildWorkspaceTree(enrichedWorkspaceFiles);

	runs.sort((left, right) => right.runId.localeCompare(left.runId));
	enrichedWorkspaceFiles.sort((left, right) => left.path.localeCompare(right.path));

	return {
		artifactsRoot,
		runs,
		workspaceDir,
		workspaceFiles: enrichedWorkspaceFiles,
		workspaceRootMode,
		workspaceTree,
	};
}

export function resolveArtifactFilePath(options: ResolveArtifactFilePathOptions) {
	const { artifactsRoot, conversationWorkspaceDir, workspaceDir, workspaceRootMode } =
		resolveWorkspaceContext(options);
	const relativePath = options.path?.trim();
	if (!relativePath) {
		throw new Error("Artifact path is required.");
	}

	const normalizedPath = relativePath
		.replace(/^\/+/, "")
		.replace(/^data\/+/, workspaceRootMode === "data" ? "" : "data/");
	if (normalizedPath.includes("..")) {
		throw new Error("Artifact path cannot escape the workspace directory.");
	}

	if (!options.runId) {
		return join(workspaceDir, normalizedPath);
	}

	const runId = options.runId.trim();
	if (!runId || runId.includes("..") || runId.includes("/")) {
		throw new Error("Artifact path cannot escape the run directory.");
	}

	const runDirCandidates = [join(artifactsRoot, runId), join(conversationWorkspaceDir, runId)];

	for (const runDir of runDirCandidates) {
		const candidate = resolvePath(runDir, normalizedPath);
		if (candidate === runDir || candidate.startsWith(`${runDir}/`)) {
			return candidate;
		}
	}

	throw new Error("Artifact path cannot escape the run directory.");
}
