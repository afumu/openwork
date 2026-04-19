import { SessionManager } from "../index.js";

export function createInMemorySessionManagerForWorkspace(workspaceDir: string): SessionManager {
	return SessionManager.inMemory(workspaceDir);
}
