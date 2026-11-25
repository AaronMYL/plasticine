import type { StateService } from '../state/index.ts';
import { grantsSection } from './autonomy.ts';
import { suggestionTaste } from './suggestions.ts';

export function loopSection(state: Partial<Pick<StateService, 'loop'>>): string {
  const loop = state.loop;
  if (loop === undefined) {
    return '';
  }
  const notes = loop.selfNotes.latest();
  return [
    notes === undefined ? '' : `## 我自己的说明书（做梦时按他最近的反应写的，照着调整做法）\n${notes.text}`,
    grantsSection({ loop }),
    suggestionTaste({ loop }),
  ].filter((part) => part !== '').join('\n\n');
}
