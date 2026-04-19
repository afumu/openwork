import { DEFAULT_DISCUSSION_MODEL, resolveDiscussionModel } from './discussionModel';

declare const describe: any;
declare const expect: any;
declare const test: any;

describe('discussion model resolution', () => {
  test('uses the explicit PI discussion model first', () => {
    expect(resolveDiscussionModel('gpt-4.1', 'gpt-5.3-codex')).toBe('gpt-5.3-codex');
  });

  test('accepts the single-value return shape from GlobalConfigService.getConfigs', () => {
    expect(resolveDiscussionModel('gpt-5.3-codex', '')).toBe('gpt-5.3-codex');
  });

  test('keeps compatibility with object-shaped test doubles', () => {
    expect(resolveDiscussionModel({ openaiBaseModel: 'gpt-5.2' }, '')).toBe('gpt-5.2');
  });

  test('falls back to the default discussion model when config is missing', () => {
    expect(resolveDiscussionModel(undefined, '')).toBe(DEFAULT_DISCUSSION_MODEL);
  });
});
