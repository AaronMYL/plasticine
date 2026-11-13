// 预测闭环第四步（11-13 Aaron 定）：每次请求前从库里现读，写进线的系统提示——做梦时写的「我自己的说明书」、他放过手的
// 几类事、他对建议卡的反应。都没有时是空串，提示和原来一样。

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
