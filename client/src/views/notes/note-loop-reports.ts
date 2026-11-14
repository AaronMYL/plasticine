// 预测闭环（11-13 Aaron 定）：续写的灰字、补充的那几条都是 Plasticine 的预测。摆出来以后他收下了（Tab、收下这句、
// 加上）报 kept；摆了一会儿没要（被打字盖掉、Esc、×、换了地方）报 rejected。一闪而过（不到 MIN_VISIBLE_MS）
// 的不报：他多半没看见，不算他的反应。报只是记一笔，不等回答、不改界面。

import type { NoteAssistOutcome } from '../../api/shared.ts';
import type { SuggestionKind } from './note-suggestion-space.ts';

import { MIN_VISIBLE_MS } from '../compose/predict-rules.ts';

export { MIN_VISIBLE_MS };

type Send = (outcome: NoteAssistOutcome) => void;

interface ShownIds { ids: readonly string[]; at: number }

const AREA: Record<SuggestionKind, NoteAssistOutcome['area']> = {
  predict: 'note_predict', interject: 'note_supplement',
};

export class LoopReports {
  readonly #send: Send;
  readonly #now: () => number;
  #shown: Record<SuggestionKind, ShownIds | null> = { predict: null, interject: null };

  constructor(send: Send, now: () => number = Date.now) {
    this.#send = send;
    this.#now = now;
  }

  /** 摆出来了：记下这几条的 id 和时刻；同一组再画一次不重新计时。 */
  shown(kind: SuggestionKind, ids: readonly (string | undefined)[]): void {
    const known = ids.filter((id): id is string => id !== undefined);
    const current = this.#shown[kind];
    if (known.length === 0) {
      this.#shown[kind] = null;
      return;
    }
    if (current !== null && current.ids.join('|') === known.join('|')) {
      return;
    }
    this.#shown[kind] = { ids: known, at: this.#now() };
  }

  /** 他收下了其中一条（续写只有一条）：这一条 kept，同一组别的够久了算 rejected。 */
  kept(kind: SuggestionKind, id: string | undefined): void {
    const current = this.#take(kind);
    if (current === null) {
      return;
    }
    const visible = this.#now() - current.at >= MIN_VISIBLE_MS;
    for (const each of current.ids) {
      if (each === id) {
        this.#send({ area: AREA[kind], loopId: each, outcome: 'kept' });
      } else if (visible) {
        this.#send({ area: AREA[kind], loopId: each, outcome: 'rejected' });
      }
    }
  }

  /** Esc 收起：他看见了、不要，不管摆了多久都算没要（和输入建议一样）。 */
  rejected(kind: SuggestionKind): void {
    const current = this.#take(kind);
    for (const id of current?.ids ?? []) {
      this.#send({ area: AREA[kind], loopId: id, outcome: 'rejected' });
    }
  }

  /** 撤下了没收：够久了才算他没要。 */
  dropped(kind: SuggestionKind): void {
    const current = this.#take(kind);
    if (current === null || this.#now() - current.at < MIN_VISIBLE_MS) {
      return;
    }
    for (const id of current.ids) {
      this.#send({ area: AREA[kind], loopId: id, outcome: 'rejected' });
    }
  }

  #take(kind: SuggestionKind): ShownIds | null {
    const current = this.#shown[kind];
    this.#shown[kind] = null;
    return current;
  }
}
