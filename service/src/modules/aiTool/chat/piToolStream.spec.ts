import {
  buildToolExecutionProgressDelta,
  mergeToolCallState,
  mergeToolExecutionState,
  serializeToolCallStates,
  serializeToolExecutionStates,
} from './piToolStream';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('piToolStream helpers', () => {
  it('merges tool execution state without losing previous fields', () => {
    const merged = mergeToolExecutionState(
      {
        tool_call_id: 'call_1',
        tool_name: 'read',
        event: 'update',
        phase: 'executing',
        args_complete: false,
        args_preview: 'path: "/tmp/a.md"',
      },
      {
        tool_call_id: 'call_1',
        tool_name: 'read',
        event: 'end',
        phase: 'completed',
        args_complete: true,
        is_error: false,
        result_preview: 'read 4.2 KB',
      },
    );

    expect(merged).toEqual({
      tool_call_id: 'call_1',
      tool_name: 'read',
      event: 'end',
      phase: 'completed',
      args_complete: true,
      is_error: false,
      args_preview: 'path: "/tmp/a.md"',
      result_preview: 'read 4.2 KB',
    });
  });

  it('builds a lightweight progress delta for a single tool execution update', () => {
    expect(
      buildToolExecutionProgressDelta({
        tool_call_id: 'call_2',
        tool_name: 'bash',
        event: 'update',
        phase: 'executing',
        args_complete: true,
        args_preview: 'echo "hi"',
      }),
    ).toEqual({
      tool_execution_delta: {
        tool_call_id: 'call_2',
        tool_name: 'bash',
        event: 'update',
        phase: 'executing',
        args_complete: true,
        args_preview: 'echo "hi"',
      },
    });
  });

  it('serializes full tool states only when explicitly requested', () => {
    const toolExecution = serializeToolExecutionStates([
      {
        tool_call_id: 'call_1',
        tool_name: 'read',
        event: 'end',
        result_preview: 'read 4.2 KB',
      },
      {
        tool_call_id: 'call_2',
        tool_name: 'bash',
        event: 'update',
        args_preview: 'echo "ok"',
      },
    ]);

    const toolCalls = serializeToolCallStates([
      mergeToolCallState(undefined, {
        id: 'tool_1',
        type: 'function',
        function: { name: 'read', arguments: '{"path":"' },
      }),
      mergeToolCallState(
        {
          id: 'tool_2',
          type: 'function',
          function: { name: 'bash', arguments: '{"command":"echo ' },
        },
        {
          function: { arguments: 'ok"}' },
        },
      ),
    ]);

    expect(toolExecution).toBe(
      '[{"tool_call_id":"call_1","tool_name":"read","event":"end","result_preview":"read 4.2 KB"},{"tool_call_id":"call_2","tool_name":"bash","event":"update","args_preview":"echo \\"ok\\""}]',
    );
    expect(toolCalls).toBe(
      '[{"id":"tool_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":\\""}},{"id":"tool_2","type":"function","function":{"name":"bash","arguments":"{\\"command\\":\\"echo ok\\"}"}}]',
    );
  });
});
