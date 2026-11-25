import type { FeedItem } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService, VideoWorkRow } from '../state/index.ts';

export const DOUYIN_SOURCE = { ref: 'douyin:favorites', kind: 'douyin', label: '抖音收藏' } as const;

export type FeedPublishState = Pick<StateService, 'feedSources' | 'feedItems' | 'videoWorks' | 'transaction'>;

export function publishToFeed(state: FeedPublishState, work: VideoWorkRow, now: Date, timeZone: string):
  FeedItem | null {
  if (work.platform !== 'douyin' || work.stage !== 'summarized' || work.digest === null) {
    return null;
  }
  return state.transaction(() => {
    const source = state.feedSources.ensure({ ...DOUYIN_SOURCE, level: 'normal' });
    const { item, created } = state.feedItems.add({
      sourceId: source.id,
      origin: 'feed',
      title: work.title.slice(0, 1_000),
      url: work.url,
      summary: work.digest?.summary ?? '',
      why: (work.digest?.related ?? []).join('\n'),
      author: work.author === null ? null : work.author.slice(0, 200),
      dedupeKey: `douyin:${work.workId}`,
      day: localDay(now, timeZone),
      publishedAt: null,
      arrivedAt: now.toISOString(),
    });
    if (work.feedItemId !== item.id) {
      state.videoWorks.advance(work.id, { feedItemId: item.id });
    }
    return created ? item : null;
  });
}
