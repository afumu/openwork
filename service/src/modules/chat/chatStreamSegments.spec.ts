import { appendInterruptedSegment, createStreamSegmentCollector } from './chatStreamSegments';
import { INTERRUPTED_CHAT_MESSAGE } from './chatPersistence';

declare const describe: any;
declare const expect: any;
declare const it: any;

describe('chat stream segment persistence', () => {
  it('keeps ordered text and tool execution deltas for history replay', () => {
    const collector = createStreamSegmentCollector();

    collector.appendText('第一段内容');
    collector.upsertToolExecution({
      tool_call_id: 'tool-1',
      tool_name: 'coremi_step',
      event: 'start',
      phase: 'executing',
      display_title: '正在搜索资料',
    });
    collector.upsertToolExecution({
      tool_call_id: 'tool-1',
      tool_name: 'coremi_step',
      event: 'end',
      phase: 'completed',
      display_subtitle: '资料搜索完成',
    });
    collector.appendText('第二段内容');

    expect(JSON.parse(collector.serialize())).toEqual([
      {
        id: expect.stringMatching(/^text-/),
        type: 'text',
        text: '第一段内容',
      },
      {
        id: 'tool-tool-1',
        type: 'tool_execution',
        tool_call_id: 'tool-1',
        tool_name: 'coremi_step',
        event: 'end',
        phase: 'completed',
        display_title: '正在搜索资料',
        display_subtitle: '资料搜索完成',
      },
      {
        id: expect.stringMatching(/^text-/),
        type: 'text',
        text: '第二段内容',
      },
    ]);
  });

  it('appends an interruption message without losing existing progress segments', () => {
    const collector = createStreamSegmentCollector();

    collector.upsertToolExecution({
      tool_call_id: 'workflow-1',
      tool_name: 'coremi_step',
      event: 'update',
      phase: 'executing',
      display_title: '正在执行 Coremi 流程',
    });
    appendInterruptedSegment(collector);

    const segments = JSON.parse(collector.serialize());
    expect(segments).toHaveLength(2);
    expect(segments[1]).toMatchObject({
      type: 'text',
      text: INTERRUPTED_CHAT_MESSAGE,
    });
  });
});
