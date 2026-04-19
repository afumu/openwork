import {
  buildChatRequestSummary,
  serializeErrorForLog,
  shouldLogProgressHeartbeat,
} from './chatTrace';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('chatTrace utils', () => {
  describe('buildChatRequestSummary', () => {
    it('summarizes prompt and attachment metadata', () => {
      const summary = buildChatRequestSummary({
        action: 'chat',
        appId: 12,
        extraParam: { foo: 'bar' },
        fileUrl: JSON.stringify([{ url: 'https://a.com/a.pdf' }, { url: 'https://a.com/b.pdf' }]),
        groupId: 34,
        imageUrl: 'https://a.com/1.png, https://a.com/2.png',
        model: 'gpt-4.1',
        prompt: 'hello world',
        proxyUrl: 'https://proxy.example.com/v1',
        timeoutMs: 300000,
        usingDeepThinking: true,
        researchMode: true,
        usingMcpTool: false,
        usingNetwork: true,
        userId: 56,
      });

      expect(summary).toEqual({
        action: 'chat',
        appId: 12,
        extraParamType: 'object',
        fileCount: 2,
        groupId: 34,
        hasExtraParam: true,
        imageCount: 2,
        model: 'gpt-4.1',
        promptLength: 11,
        proxyUrl: 'https://proxy.example.com/v1',
        timeoutMs: 300000,
        usingDeepThinking: true,
        researchMode: true,
        usingMcpTool: false,
        usingNetwork: true,
        userId: 56,
      });
    });

    it('handles empty values safely', () => {
      expect(
        buildChatRequestSummary({
          prompt: '',
          imageUrl: '',
          fileUrl: null,
        }),
      ).toMatchObject({
        fileCount: 0,
        hasExtraParam: false,
        imageCount: 0,
        researchMode: false,
        promptLength: 0,
      });
    });
  });

  describe('serializeErrorForLog', () => {
    it('serializes regular errors', () => {
      const error = new Error('gateway disconnected');
      error.stack = 'Error: gateway disconnected\n    at test';

      expect(serializeErrorForLog(error)).toEqual({
        message: 'gateway disconnected',
        name: 'Error',
        stack: 'Error: gateway disconnected\n    at test',
      });
    });

    it('serializes object-like errors with status fields', () => {
      expect(
        serializeErrorForLog({
          code: 'ECONNRESET',
          message: 'socket hang up',
          response: { status: 502, statusText: 'Bad Gateway' },
        }),
      ).toEqual({
        code: 'ECONNRESET',
        message: 'socket hang up',
        response: {
          status: 502,
          statusText: 'Bad Gateway',
        },
      });
    });
  });

  describe('shouldLogProgressHeartbeat', () => {
    it('logs the first event immediately', () => {
      expect(shouldLogProgressHeartbeat(1, 0, 1000)).toBe(true);
    });

    it('logs on configured event interval', () => {
      expect(shouldLogProgressHeartbeat(25, 1000, 2000)).toBe(true);
    });

    it('logs when enough time has elapsed', () => {
      expect(shouldLogProgressHeartbeat(7, 1000, 17050)).toBe(true);
    });

    it('skips heartbeat logs when thresholds are not met', () => {
      expect(shouldLogProgressHeartbeat(7, 5000, 10000)).toBe(false);
    });
  });
});
