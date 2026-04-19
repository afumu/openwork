import {
  buildAssistantFailureLogUpdate,
  INTERRUPTED_CHAT_MESSAGE,
  looksLikeTransientAssistantFailure,
} from './chatPersistence';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('chatPersistence', () => {
  it('stores a friendly interruption message instead of raw upstream errors', () => {
    const update = buildAssistantFailureLogUpdate({
      errMsg:
        '429 upstream model request failed after 3 attempts: HTTP 429 body: 当前分组上游负载已饱和',
    });

    expect(update.content).toBe(INTERRUPTED_CHAT_MESSAGE);
    expect(update.status).toBe(4);
  });

  it('preserves generated partial content when a stream fails', () => {
    const update = buildAssistantFailureLogUpdate({
      errMsg: 'This operation was aborted',
      full_content: '这是中断前已经生成的正文。',
      full_reasoning_content: '这是中断前已经生成的推理。',
    });

    expect(update.content).toBe('这是中断前已经生成的正文。');
    expect(update.reasoning_content).toBe('这是中断前已经生成的推理。');
    expect(update.status).toBe(4);
  });

  it('recognizes transient assistant failures that should not erase user history', () => {
    expect(looksLikeTransientAssistantFailure('This operation was aborted')).toBe(true);
    expect(
      looksLikeTransientAssistantFailure(
        '429 upstream model request failed after 3 attempts: 当前分组上游负载已饱和',
      ),
    ).toBe(true);
    expect(looksLikeTransientAssistantFailure('这是一次真实生成的部分回答。')).toBe(false);
  });
});
