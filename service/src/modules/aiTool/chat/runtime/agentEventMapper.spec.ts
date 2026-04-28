import { mapBridgeEventToChatProgress } from './agentEventMapper';

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
        result_preview: 'match',
        tool_call_id: 'tool-1',
        tool_name: 'tool',
      },
    });
  });
});
