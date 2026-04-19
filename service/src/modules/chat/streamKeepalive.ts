export const STREAM_KEEPALIVE_INTERVAL_MS = 15_000;

type StreamableResponse = {
  destroyed?: boolean;
  flushHeaders?: () => void;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => void;
  writableEnded?: boolean;
  write: (chunk: string) => void;
};

function canWrite(res: StreamableResponse) {
  return !res.writableEnded && !res.destroyed;
}

export function configureStreamingResponse(res: StreamableResponse) {
  res.status(200);
  res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  if (canWrite(res)) {
    res.write('\n');
  }
}

export function startStreamKeepalive(
  res: StreamableResponse,
  intervalMs = STREAM_KEEPALIVE_INTERVAL_MS,
) {
  const writeHeartbeat = () => {
    if (!canWrite(res)) {
      return;
    }

    res.write('\n');
  };

  writeHeartbeat();

  const timer = setInterval(writeHeartbeat, intervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}
