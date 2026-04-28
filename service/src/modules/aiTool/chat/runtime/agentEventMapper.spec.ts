import { createBridgeEventProgressMapper, mapBridgeEventToChatProgress } from './agentEventMapper';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('OpenSandbox bridge event mapper', () => {
  it('maps assistant deltas into existing content progress payloads', () => {
    expect(mapBridgeEventToChatProgress({ text: 'hello', type: 'assistant_delta' })).toEqual({
      content: [{ text: 'hello', type: 'text' }],
    });
    expect(mapBridgeEventToChatProgress({ text: ' world', type: 'assistant_text' })).toEqual({
      content: [{ text: ' world', type: 'text' }],
    });
  });

  it('maps tool lifecycle events into stream segment deltas', () => {
    expect(
      mapBridgeEventToChatProgress({
        input: { command: 'rg test' },
        tool: 'Bash',
        tool_call_id: 'tool-1',
        type: 'tool_started',
      }),
    ).toEqual({
      tool_execution_delta: {
        args_complete: true,
        args_preview: '{"command":"rg test"}',
        event: 'start',
        input: { command: 'rg test' },
        phase: 'executing',
        tool_call_id: 'tool-1',
        tool_name: 'Bash',
      },
    });

    expect(
      mapBridgeEventToChatProgress({
        stdout: 'match',
        tool_call_id: 'tool-1',
        type: 'tool_output',
      }),
    ).toEqual({
      tool_execution_delta: {
        event: 'update',
        phase: 'executing',
        result: 'match',
        result_preview: 'match',
        tool_call_id: 'tool-1',
        tool_name: 'tool',
      },
    });
  });

  it('preserves structured tool result payloads for frontend tool renderers', () => {
    expect(
      mapBridgeEventToChatProgress({
        content: 'read done',
        tool_call_id: 'read-1',
        tool_name: 'Read',
        tool_use_result: {
          file: {
            content: 'hello\nworld',
            filePath: '/workspace/README.md',
            numLines: 2,
            startLine: 1,
            totalLines: 2,
          },
          type: 'text',
        },
        type: 'tool_result',
      }),
    ).toEqual({
      tool_execution_delta: {
        event: 'end',
        is_error: false,
        phase: 'completed',
        result: {
          file: {
            content: 'hello\nworld',
            filePath: '/workspace/README.md',
            numLines: 2,
            startLine: 1,
            totalLines: 2,
          },
          type: 'text',
        },
        result_preview: 'read done',
        tool_call_id: 'read-1',
        tool_name: 'Read',
      },
    });
  });

  it('maps raw Claude SDK stream events into early tool execution deltas', () => {
    const mapProgress = createBridgeEventProgressMapper();

    expect(
      mapProgress({
        raw: {
          event: {
            content_block: {
              id: 'toolu-bash',
              input: {},
              name: 'Bash',
              type: 'tool_use',
            },
            index: 1,
            type: 'content_block_start',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      tool_execution_delta: {
        args_complete: false,
        args_preview: '{}',
        event: 'start',
        input: {},
        phase: 'assembling',
        tool_call_id: 'toolu-bash',
        tool_name: 'Bash',
      },
    });

    expect(
      mapProgress({
        raw: {
          event: {
            delta: {
              partial_json: '{"command":',
              type: 'input_json_delta',
            },
            index: 1,
            type: 'content_block_delta',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      tool_execution_delta: {
        args_complete: false,
        args_preview: '{"command":',
        event: 'update',
        input: '{"command":',
        phase: 'assembling',
        tool_call_id: 'toolu-bash',
        tool_name: 'Bash',
      },
    });

    expect(
      mapProgress({
        raw: {
          event: {
            delta: {
              partial_json: '"rg OpenSandbox"}',
              type: 'input_json_delta',
            },
            index: 1,
            type: 'content_block_delta',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      tool_execution_delta: {
        args_complete: false,
        args_preview: '{"command":"rg OpenSandbox"}',
        event: 'update',
        input: { command: 'rg OpenSandbox' },
        phase: 'assembling',
        tool_call_id: 'toolu-bash',
        tool_name: 'Bash',
      },
    });

    expect(
      mapProgress({
        raw: {
          event: {
            index: 1,
            type: 'content_block_stop',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      tool_execution_delta: {
        args_complete: true,
        args_preview: '{"command":"rg OpenSandbox"}',
        event: 'start',
        input: { command: 'rg OpenSandbox' },
        phase: 'executing',
        tool_call_id: 'toolu-bash',
        tool_name: 'Bash',
      },
    });
  });

  it('streams raw Claude SDK thinking deltas immediately without duplicating final thinking', () => {
    const mapProgress = createBridgeEventProgressMapper();

    expect(
      mapProgress({
        raw: {
          event: {
            content_block: {
              thinking: '',
              type: 'thinking',
            },
            index: 0,
            type: 'content_block_start',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toBeNull();

    expect(
      mapProgress({
        raw: {
          event: {
            delta: {
              thinking: '先分析需求',
              type: 'thinking_delta',
            },
            index: 0,
            type: 'content_block_delta',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      reasoning_content: [{ text: '先分析需求', type: 'text' }],
    });

    expect(
      mapProgress({
        raw: {
          event: {
            delta: {
              thinking: '，再执行工具',
              type: 'thinking_delta',
            },
            index: 0,
            type: 'content_block_delta',
          },
          type: 'stream_event',
        },
        type: 'raw_sdk_message',
      }),
    ).toEqual({
      reasoning_content: [{ text: '，再执行工具', type: 'text' }],
    });

    expect(
      mapProgress({
        text: '先分析需求，再执行工具',
        type: 'assistant_thinking',
      }),
    ).toBeNull();
  });
});
