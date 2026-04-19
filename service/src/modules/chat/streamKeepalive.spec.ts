declare const describe: any;
declare const expect: any;
declare const jest: any;
declare const test: any;

import {
  configureStreamingResponse,
  startStreamKeepalive,
  STREAM_KEEPALIVE_INTERVAL_MS,
} from './streamKeepalive';

describe('stream keepalive helpers', () => {
  test('configureStreamingResponse sets streaming-friendly headers and sends bootstrap chunk', () => {
    const setHeader = jest.fn();
    const status = jest.fn();
    const flushHeaders = jest.fn();
    const write = jest.fn();

    configureStreamingResponse({
      setHeader,
      status,
      flushHeaders,
      write,
    } as any);

    expect(status).toHaveBeenCalledWith(200);
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/octet-stream; charset=utf-8',
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(flushHeaders).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('\n');
  });

  test('startStreamKeepalive writes heartbeat chunks on an interval until stopped', () => {
    jest.useFakeTimers();

    const write = jest.fn();
    const stop = startStreamKeepalive({
      write,
      writableEnded: false,
      destroyed: false,
    } as any);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith('\n');

    jest.advanceTimersByTime(STREAM_KEEPALIVE_INTERVAL_MS * 2);
    expect(write).toHaveBeenCalledTimes(3);

    stop();
    jest.advanceTimersByTime(STREAM_KEEPALIVE_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });
});
