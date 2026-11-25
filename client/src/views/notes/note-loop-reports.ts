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

  rejected(kind: SuggestionKind): void {
    const current = this.#take(kind);
    for (const id of current?.ids ?? []) {
      this.#send({ area: AREA[kind], loopId: id, outcome: 'rejected' });
    }
  }

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
