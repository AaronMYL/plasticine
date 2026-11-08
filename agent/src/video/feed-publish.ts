// 抖音收藏总结好了进信息流（《优化清单》第 9 条：跑通再接入信息流）：来源「抖音收藏」，一条作品一条条目（按作品 ID
// 去重，再总结一次也不出两条）。卡片上列核心观点和「和你有关」（视图从 video_works 读，见 app/daily-views.ts）。

import type { FeedItem } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService, VideoWorkRow } from '../state/index.ts';

export const DOUYIN_SOURCE = { ref: 'douyin:favorites', kind: 'douyin', label: '抖音收藏' } as const;

export type FeedPublishState = Pick<StateService, 'feedSources' | 'feedItems' | 'videoWorks' | 'transaction'>;

/** 只发抖音的、总结好的；回新加的条目（已经发过就是 null）。 */
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
      publishedAt: work.collectedAt,
      arrivedAt: now.toISOString(),
    });
    if (work.feedItemId !== item.id) {
      state.videoWorks.advance(work.id, { feedItemId: item.id });
    }
    return created ? item : null;
  });
}
