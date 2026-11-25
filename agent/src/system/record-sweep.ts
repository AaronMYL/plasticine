import type { StateService } from '../state/index.ts';
import { safeLog } from '../util/index.ts';

export const NODE_ACTION_RESULT_DAYS = 30;
export const SWEEP_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export class RecordSweep {
  readonly #state: Pick<StateService, 'nodeActions' | 'apiRequests'>;
  readonly #now: () => Date;
  #doneDay: string | null = null;

  constructor(state: Pick<StateService, 'nodeActions' | 'apiRequests'>, now: () => Date) {
    this.#state = state;
    this.#now = now;
  }

  run(): { trimmed: number; purged: number } {
    const now = this.#now();
    const day = now.toISOString().slice(0, 10);
    if (day === this.#doneDay) {
      return { trimmed: 0, purged: 0 };
    }
    const before = new Date(now.getTime() - NODE_ACTION_RESULT_DAYS * DAY_MS).toISOString();
    const trimmed = this.#state.nodeActions.trimResults(before, SWEEP_BATCH);
    const purged = this.#state.apiRequests.purgeExpired(now.toISOString(), SWEEP_BATCH);
    if (trimmed < SWEEP_BATCH && purged < SWEEP_BATCH) {
      this.#doneDay = day;
    }
    if (trimmed > 0 || purged > 0) {
      safeLog('log', 'records_swept', { counts: { count: trimmed, deleted: purged } });
    }
    return { trimmed, purged };
  }
}
