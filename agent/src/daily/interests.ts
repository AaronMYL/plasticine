import type { FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { checkLinkData } from './link-data.ts';

export const INTEREST_GROUP_PREFIX = 'interest:';

export type InterestState = Pick<StateService, 'feedSources'>;

export class InterestDesk {
  readonly #state: InterestState;

  constructor(options: { state: InterestState }) {
    this.#state = options.state;
  }

  /** Inside the caller's transaction (an idempotent request). */
  add(input: { label: string; query?: string }): { source: FeedSource } {
    input = checkLinkData(input);
    const created = this.#state.feedSources.create({
      kind: 'interest',
      label: input.label,
      query: input.query ?? input.label,
      level: 'more',
    });
    const source = this.#state.feedSources.update(created.id, created.version,
      { concernId: `${INTEREST_GROUP_PREFIX}${created.id}` });
    return { source };
  }

  setLevel(id: string, version: number, level: FeedSource['level']): FeedSource {
    return this.#state.feedSources.update(id, version, { level });
  }
}
