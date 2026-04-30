import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getOpenWorkSystemPromptConfig } from "./bridgePrompt.mjs";

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CLAUDE_BRIDGE_PORT || "8765");
const cwd = process.env.CLAUDE_BRIDGE_CWD || "/workspace";
const model = process.env.ANTHROPIC_MODEL || undefined;
const permissionMode = process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";
const allowedTools = (process.env.CLAUDE_ALLOWED_TOOLS || "Bash,Read,Write,Edit,Glob,Grep,LS")
  .split(",")
  .map((tool) => tool.trim())
  .filter(Boolean);
const openworkDir = path.join(cwd, ".openwork");
const claudeConfigDir = path.join(openworkDir, "claude-config");
const claudeSessionPointerPath = path.join(openworkDir, "claude-session.json");
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

async function ensureClaudePersistenceDirs() {
  await fs.promises.mkdir(claudeConfigDir, { recursive: true });
}

function getStringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOpenworkMetadata(body = {}) {
  return {
    openworkSessionId: getStringValue(body.openworkSessionId) || getStringValue(body.session_id),
    userId: getStringValue(body.userId) || getStringValue(body.user_id),
    groupId: getStringValue(body.groupId) || getStringValue(body.group_id),
  };
}

async function readSessionPointer() {
  try {
    const raw = await fs.promises.readFile(claudeSessionPointerPath, "utf8");
    const pointer = JSON.parse(raw);
    const claudeSessionId = getStringValue(pointer?.claudeSessionId);
    if (pointer?.provider !== "claude" || pointer?.workspace !== cwd || !claudeSessionId) {
      return null;
    }
    return { ...pointer, claudeSessionId };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.warn(
      JSON.stringify({
        type: "session_pointer_ignored",
        path: claudeSessionPointerPath,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

async function writeSessionPointer(claudeSessionId, metadata = {}) {
  if (!getStringValue(claudeSessionId)) return;

  const pointer = {
    version: 1,
    provider: "claude",
    workspace: cwd,
    claudeSessionId,
    updatedAt: new Date().toISOString(),
  };
  for (const key of ["openworkSessionId", "userId", "groupId"]) {
    const value = getStringValue(metadata[key]);
    if (value) pointer[key] = value;
  }

  const tmpPath = `${claudeSessionPointerPath}.${process.pid}.${randomUUID()}.tmp`;
  const file = await fs.promises.open(tmpPath, "w");
  try {
    await file.writeFile(`${JSON.stringify(pointer, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.promises.rename(tmpPath, claudeSessionPointerPath);
}

function findClaudeExecutable() {
  const platform = process.platform;
  const arch = process.arch;
  const candidates = [
    process.env.CLAUDE_CODE_EXECUTABLE_PATH,
    path.join(bridgeDir, "node_modules", "@anthropic-ai", `claude-code-${platform}-${arch}`, "claude"),
    path.join(bridgeDir, "node_modules", "@anthropic-ai", `claude-code-${platform}-${arch}-musl`, "claude"),
    path.join(bridgeDir, "node_modules", ".bin", "claude"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const pathToClaudeCodeExecutable = findClaudeExecutable();

class MessageQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
  }

  push(text) {
    const message = {
      type: "user",
      uuid: randomUUID(),
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: text,
      },
    };
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter(message);
      return 0;
    }
    this.items.push(message);
    return this.items.length;
  }

  next() {
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async *generator() {
    while (true) {
      yield await this.next();
    }
  }
}

const queue = new MessageQueue();
const clients = new Set();
const eventLog = [];
let nextEventId = 1;
let activeSessionId = null;
let persistedSessionId = null;
let latestOpenworkMetadata = {};
let pendingResumeSessionId = null;
let status = "starting";
let abortController = new AbortController();
let sdkQuery = null;

function emit(type, data = {}) {
  const event = {
    id: nextEventId++,
    type,
    timestamp: new Date().toISOString(),
    session_id: activeSessionId,
    ...data,
  };
  eventLog.push(event);
  if (eventLog.length > 1000) eventLog.shift();

  const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }

  // Keep container logs useful even when no client is attached.
  console.log(JSON.stringify(event));
  return event;
}

function getContentItems(message) {
  const content = message?.message?.content;
  if (Array.isArray(content)) return content.filter((item) => item && typeof item === "object");
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

async function normalizeSdkMessage(message) {
  const normalized = [];
  const messageType = message?.type || "unknown";
  const subtype = message?.subtype;

  if (message.session_id && activeSessionId !== message.session_id) {
    activeSessionId = message.session_id;
    if (persistedSessionId !== message.session_id) {
      try {
        await writeSessionPointer(message.session_id, latestOpenworkMetadata);
        persistedSessionId = message.session_id;
      } catch (error) {
        normalized.push({
          type: "error",
          data: {
            message: "failed to persist Claude session pointer",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    if (pendingResumeSessionId) {
      normalized.push({
        type: "session_resume_succeeded",
        data: { session_id: pendingResumeSessionId },
      });
      pendingResumeSessionId = null;
    }
    normalized.push({
      type: "session_started",
      data: {
        provider: "claude",
        raw_type: messageType,
        subtype,
        cwd,
        workspace: cwd,
        claudeSessionId: message.session_id,
        claude_config_dir: claudeConfigDir,
        session_pointer_path: claudeSessionPointerPath,
        model: message.model || model,
      },
    });
  }

  for (const item of getContentItems(message)) {
    if (item.type === "text" && item.text) {
      normalized.push({ type: "assistant_text", data: { text: item.text } });
    } else if (item.type === "thinking" && item.thinking) {
      normalized.push({ type: "assistant_thinking", data: { text: item.thinking } });
    } else if (item.type === "tool_use") {
      normalized.push({
        type: "tool_use",
        data: {
          tool_call_id: item.id,
          name: item.name,
          input: item.input ?? {},
        },
      });
    } else if (item.type === "tool_result") {
      normalized.push({
        type: "tool_result",
        data: {
          tool_call_id: item.tool_use_id,
          content: item.content,
          is_error: item.is_error ?? false,
        },
      });
    }
  }

  if (message.tool_use_result !== undefined) {
    normalized.push({
      type: "tool_result",
      data: {
        tool_use_result: message.tool_use_result,
      },
    });
  }

  if (messageType === "result") {
    status = "idle";
    normalized.push({
      type: "turn_complete",
      data: {
        subtype,
        duration_ms: message.duration_ms,
        duration_api_ms: message.duration_api_ms,
        is_error: message.is_error,
        result: message.result,
        total_cost_usd: message.total_cost_usd,
      },
    });
  } else if (messageType === "error") {
    status = "failed";
    normalized.push({ type: "error", data: { error: message.error || message } });
  }

  normalized.push({
    type: "raw_sdk_message",
    data: {
      raw: message,
    },
  });
  return normalized;
}

function buildQueryOptions(sessionOptions = {}) {
  return {
    cwd,
    model,
    abortController,
    includePartialMessages: true,
    allowedTools,
    permissionMode,
    pathToClaudeCodeExecutable,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    settingSources: ["user", "project", "local"],
    systemPrompt: getOpenWorkSystemPromptConfig(),
    persistSession: true,
    ...sessionOptions,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      CLAUDE_AGENT_SDK_CLIENT_APP: "opensandbox-supervisor-demo/0.1",
    },
  };
}

async function runAgentQuery(sessionOptions = {}) {
  sdkQuery = query({
    prompt: queue.generator(),
    options: buildQueryOptions(sessionOptions),
  });

  status = "idle";
  emit("bridge_ready", {
    cwd,
    model,
    permission_mode: permissionMode,
    allowed_tools: allowedTools,
    path_to_claude_code_executable: pathToClaudeCodeExecutable,
    claude_config_dir: claudeConfigDir,
    session_pointer_path: claudeSessionPointerPath,
    resume_session_id: sessionOptions.resume,
    continue_session: sessionOptions.continue === true,
  });

  for await (const message of sdkQuery) {
    for (const event of await normalizeSdkMessage(message)) {
      emit(event.type, event.data);
    }
  }

  status = "stopped";
  emit("agent_stopped");
}

async function startAgent() {
  try {
    await ensureClaudePersistenceDirs();
    const pointer = await readSessionPointer();
    persistedSessionId = pointer?.claudeSessionId || null;

    if (pointer?.claudeSessionId) {
      pendingResumeSessionId = pointer.claudeSessionId;
      emit("session_resume_started", {
        session_id: pointer.claudeSessionId,
        workspace: cwd,
        session_pointer_path: claudeSessionPointerPath,
      });
      try {
        await runAgentQuery({ resume: pointer.claudeSessionId });
        return;
      } catch (error) {
        pendingResumeSessionId = null;
        emit("session_resume_failed", {
          session_id: pointer.claudeSessionId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      try {
        await runAgentQuery({ continue: true });
        return;
      } catch (error) {
        emit("session_continue_failed", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    await runAgentQuery();
  } catch (error) {
    status = "failed";
    emit("error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: status !== "failed",
      status,
      session_id: activeSessionId,
      next_event_id: nextEventId,
    });
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const since = Number(url.searchParams.get("since") || req.headers["last-event-id"] || "0");
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    clients.add(res);
    for (const event of eventLog) {
      if (event.id > since) {
        res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/message") {
    try {
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) {
        return sendJson(res, 400, { error: "text is required" });
      }
      const incomingMetadata = normalizeOpenworkMetadata(body);
      let metadataChanged = false;
      for (const key of ["openworkSessionId", "userId", "groupId"]) {
        if (incomingMetadata[key] && latestOpenworkMetadata[key] !== incomingMetadata[key]) {
          latestOpenworkMetadata[key] = incomingMetadata[key];
          metadataChanged = true;
        }
      }
      if (activeSessionId && metadataChanged) {
        try {
          await writeSessionPointer(activeSessionId, latestOpenworkMetadata);
          persistedSessionId = activeSessionId;
        } catch (error) {
          emit("error", {
            message: "failed to update Claude session pointer metadata",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      status = "running";
      const depth = queue.push(text);
      emit("user_message", {
        text,
        queue_depth: depth,
        openwork_session_id: latestOpenworkMetadata.openworkSessionId,
        user_id: latestOpenworkMetadata.userId,
        group_id: latestOpenworkMetadata.groupId,
      });
      return sendJson(res, 202, { ok: true, queue_depth: depth, status });
    } catch (error) {
      return sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/stop") {
    abortController.abort();
    sdkQuery?.close?.();
    status = "stopping";
    emit("stop_requested");
    return sendJson(res, 202, { ok: true });
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.error(`[bridge] listening on ${port}`);
  void startAgent();
});
