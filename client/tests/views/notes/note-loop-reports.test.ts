import { describe, expect, it } from 'vitest';
import type { NoteAssistOutcome } from '../../../src/api/shared.ts';
import { LoopReports, MIN_VISIBLE_MS } from '../../../src/views/notes/note-loop-reports.ts';

function reports(): { sent: NoteAssistOutcome[]; at: { now: number }; loop: LoopReports } {
  const sent: NoteAssistOutcome[] = [];
  const at = { now: 0 };
  return { sent, at, loop: new LoopReports((outcome) => sent.push(outcome), () => at.now) };
}

describe('Prediction feedback loop: supplement and continuation outcomes', () => {
  it('accepting one marks it kept and marks sibling items shown long enough as rejected', () => {
    const { sent, at, loop } = reports();
    loop.shown('interject', ['a', 'b', undefined]);
    at.now = MIN_VISIBLE_MS;
    loop.kept('interject', 'a');
    expect(sent).toEqual([{ area: 'note_supplement', loopId: 'a', outcome: 'kept' },
      { area: 'note_supplement', loopId: 'b', outcome: 'rejected' }]);
    loop.dropped('interject');
    expect(sent).toHaveLength(2);
  });

  it('skips reporting items flashed briefly or lacking an id', () => {
    const { sent, at, loop } = reports();
    loop.shown('predict', ['p']);
    at.now = MIN_VISIBLE_MS - 1;
    loop.dropped('predict');
    loop.shown('predict', [undefined]);
    at.now = 10 * MIN_VISIBLE_MS;
    loop.dropped('predict');
    expect(sent).toEqual([]);
  });

  it('pressing Esc dismisses items as rejected regardless of display duration', () => {
    const { sent, loop } = reports();
    loop.shown('interject', ['a', 'b']);
    loop.rejected('interject');
    expect(sent).toEqual([{ area: 'note_supplement', loopId: 'a', outcome: 'rejected' },
      { area: 'note_supplement', loopId: 'b', outcome: 'rejected' }]);
    loop.rejected('interject');
    expect(sent).toHaveLength(2);
  });
});
