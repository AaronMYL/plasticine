// 关注点（《UI 方案》第 7、9 节）：每个关注点是一条探索方向，信息流是这些探索方向带回东西的地方。关掉关注点只把来源
// 置成 off。2026-11-05 关切删掉：加关注点不再同时开一条关切，只是一个信息流来源。concern_id 那一列原来存关切 id，
// 是关注点、挂在它下面的订阅和命中它的条目共用的分组键（命中的条目排在前面）；现在新加的关注点用 interest:<来源 id>。

import type { FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { cleanLinkData } from './link-data.ts';

/** 新加的关注点的分组键前缀。 */
export const INTEREST_GROUP_PREFIX = 'interest:';

export type InterestState = Pick<StateService, 'feedSources'>;

export class InterestDesk {
  readonly #state: InterestState;

  constructor(options: { state: InterestState }) {
    this.#state = options.state;
  }

  /** Inside the caller's transaction (an idempotent request). */
  add(input: { label: string; query?: string }): { source: FeedSource } {
    input = cleanLinkData(input);
    // A user-added 关注点 starts at 多 (1ca0391 daily.ts: level 'more' for the user's own).
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
