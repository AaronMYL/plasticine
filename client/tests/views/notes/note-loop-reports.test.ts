import { describe, expect, it } from 'vitest';
import type { NoteAssistOutcome } from '../../../src/api/shared.ts';
import { LoopReports, MIN_VISIBLE_MS } from '../../../src/views/notes/note-loop-reports.ts';

function reports(): { sent: NoteAssistOutcome[]; at: { now: number }; loop: LoopReports } {
  const sent: NoteAssistOutcome[] = [];
  const at = { now: 0 };
  return { sent, at, loop: new LoopReports((outcome) => sent.push(outcome), () => at.now) };
}

describe('预测闭环：补充和续写的结果', () => {
  it('加上一条：这条 kept，同组摆够久的其余几条 rejected', () => {
    const { sent, at, loop } = reports();
    loop.shown('interject', ['a', 'b', undefined]);
    at.now = MIN_VISIBLE_MS;
    loop.kept('interject', 'a');
    expect(sent).toEqual([{ area: 'note_supplement', loopId: 'a', outcome: 'kept' },
      { area: 'note_supplement', loopId: 'b', outcome: 'rejected' }]);
    loop.dropped('interject');
    expect(sent).toHaveLength(2);
  });

  it('一闪而过的不报，没有 id 的不报', () => {
    const { sent, at, loop } = reports();
    loop.shown('predict', ['p']);
    at.now = MIN_VISIBLE_MS - 1;
    loop.dropped('predict');
    loop.shown('predict', [undefined]);
    at.now = 10 * MIN_VISIBLE_MS;
    loop.dropped('predict');
    expect(sent).toEqual([]);
  });

  it('Esc 收起（和输入建议对齐）：不管摆了多久都算没要', () => {
    const { sent, loop } = reports();
    loop.shown('interject', ['a', 'b']);
    loop.rejected('interject');
    expect(sent).toEqual([{ area: 'note_supplement', loopId: 'a', outcome: 'rejected' },
      { area: 'note_supplement', loopId: 'b', outcome: 'rejected' }]);
    loop.rejected('interject');
    expect(sent).toHaveLength(2);
  });
});
