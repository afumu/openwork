import { relative, resolve } from "node:path";

export interface PathPolicy {
	allowRoots: string[];
	denyRoots: string[];
}

export function isPathInside(child: string, parent: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

export function assertPathAllowed(path: string, policy: PathPolicy): void {
	const denied = policy.denyRoots.some((root) => isPathInside(path, root));
	if (denied) {
		throw new Error(`Access denied by runtime policy: ${path}`);
	}

	const allowed = policy.allowRoots.some((root) => isPathInside(path, root));
	if (!allowed) {
		throw new Error(`Path is outside the allowed workspace: ${path}`);
	}
}
