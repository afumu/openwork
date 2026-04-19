type UnknownRecord = Record<string, any>;

function countAttachmentItems(value: unknown): number {
  if (!value) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value !== 'string') {
    return 1;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.length;
    }

    return parsed ? 1 : 0;
  } catch {
    return trimmed
      .split(',')
      .map(item => item.trim())
      .filter(Boolean).length;
  }
}

export function buildChatRequestSummary(input: {
  userId?: number | string;
  groupId?: number | string;
  appId?: number | string;
  model?: string;
  action?: string;
  prompt?: string;
  proxyUrl?: string;
  timeoutMs?: number;
  usingNetwork?: boolean;
  usingDeepThinking?: boolean;
  researchMode?: boolean;
  usingMcpTool?: boolean;
  extraParam?: unknown;
  fileUrl?: unknown;
  imageUrl?: unknown;
}) {
  return {
    userId: input.userId ?? null,
    groupId: input.groupId ?? null,
    appId: input.appId ?? null,
    model: input.model ?? null,
    action: input.action ?? null,
    promptLength: input.prompt?.length ?? 0,
    fileCount: countAttachmentItems(input.fileUrl),
    imageCount: countAttachmentItems(input.imageUrl),
    hasExtraParam: input.extraParam !== undefined && input.extraParam !== null,
    extraParamType:
      input.extraParam !== undefined && input.extraParam !== null
        ? Array.isArray(input.extraParam)
          ? 'array'
          : typeof input.extraParam
        : null,
    proxyUrl: input.proxyUrl ?? null,
    timeoutMs: input.timeoutMs ?? null,
    usingNetwork: Boolean(input.usingNetwork),
    usingDeepThinking: Boolean(input.usingDeepThinking),
    researchMode: Boolean(input.researchMode),
    usingMcpTool: Boolean(input.usingMcpTool),
  };
}

export function shouldLogProgressHeartbeat(
  progressEventCount: number,
  lastLoggedAt: number,
  now: number,
  everyCount = 25,
  intervalMs = 15000,
) {
  if (progressEventCount <= 1) {
    return true;
  }

  if (progressEventCount % everyCount === 0) {
    return true;
  }

  return now - lastLoggedAt >= intervalMs;
}

export function serializeErrorForLog(error: unknown): UnknownRecord {
  if (error instanceof Error) {
    const serialized: UnknownRecord = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    const errorWithExtras = error as Error & UnknownRecord;
    if (errorWithExtras.code) {
      serialized.code = errorWithExtras.code;
    }
    if (errorWithExtras.type) {
      serialized.type = errorWithExtras.type;
    }
    if (errorWithExtras.status) {
      serialized.status = errorWithExtras.status;
    }
    if (errorWithExtras.statusCode) {
      serialized.statusCode = errorWithExtras.statusCode;
    }
    if (errorWithExtras.response) {
      serialized.response = summarizeResponse(errorWithExtras.response);
    }
    if (errorWithExtras.cause) {
      serialized.cause = serializeErrorForLog(errorWithExtras.cause);
    }

    return serialized;
  }

  if (error && typeof error === 'object') {
    const maybeError = error as UnknownRecord;
    const serialized: UnknownRecord = {};

    for (const key of ['name', 'message', 'code', 'type', 'status', 'statusCode', 'stack']) {
      if (maybeError[key] !== undefined) {
        serialized[key] = maybeError[key];
      }
    }

    if (maybeError.response !== undefined) {
      serialized.response = summarizeResponse(maybeError.response);
    }

    if (maybeError.cause !== undefined) {
      serialized.cause = serializeErrorForLog(maybeError.cause);
    }

    return Object.keys(serialized).length > 0 ? serialized : { value: maybeError };
  }

  return { value: error };
}

function summarizeResponse(response: unknown) {
  if (!response || typeof response !== 'object') {
    return response;
  }

  const maybeResponse = response as UnknownRecord;

  return {
    status: maybeResponse.status,
    statusText: maybeResponse.statusText,
    data: maybeResponse.data,
  };
}
