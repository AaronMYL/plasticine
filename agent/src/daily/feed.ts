// 信息流（《UI 方案》第 9 节，M4）：条目、反应（赞 / 不感兴趣 / 收藏）、手动添加；站外的 RSS / Atom 和关注点搜索在
// external-feed.ts。2026-11-04 用户定：信息流只放站外资讯，以前的站内收集（做完的任务、项目新添 / 了结）停掉；那两个
// 站内来源的旧条目和来源行都留着，列表、计数按来源过滤（shared FEED_LIST_ORIGINS），信息源里不再列出（RETIRED_SOURCE_REFS）。

import type { FeedItem, FeedItemInput, FeedSource } from '../../shared/state.ts';
import type { AfterCommit } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { dayRange, localDay } from './days.ts';
import { DailyError } from './errors.ts';
import { cleanUrl, siteOf } from './urls.ts';

export type FeedState = Pick<StateService, 'feedItems' | 'feedSources'>;

/**
 * The built-in sources, found again by their ref. 第 3 批（11-04）加两行：X 上他关注的人、「按关注点搜新闻」这个总开关
 * （设置里「信息流来源」各一行，开关就是它们的 level）。
 */
export const BUILT_IN_SOURCES = {
  manual: { ref: 'internal:manual', kind: 'internal', label: '手动添加' },
  x: { ref: 'x:following', kind: 'x', label: 'X' },
  news: { ref: 'internal:news', kind: 'internal', label: '兴趣' },
  // 第13批：小红书（首页推荐 + 自己的收藏，电脑客户端用他的登录读）。
  xhs: { ref: 'xhs:feed', kind: 'xhs', label: '小红书' },
} as const;

/** 停掉的站内来源（任务、项目）：库里的来源行留着，信息源列表不再列出。 */
export const RETIRED_SOURCE_REFS: readonly string[] = ['internal:task', 'internal:concern'];

export interface FeedSink {
  itemChanged(item: FeedItem): void;
}

export interface ManualItem {
  requestId: string;
  title: string;
  url?: string;
  summary?: string;
  why?: string;
}

export class FeedDesk {
  readonly #state: FeedState;
  readonly #now: () => Date;
  #sink: FeedSink = { itemChanged: () => undefined };

  constructor(options: { state: FeedState; now: () => Date }) {
    this.#state = options.state;
    this.#now = options.now;
  }

  attach(sink: FeedSink): void {
    this.#sink = sink;
  }

  announce(item: FeedItem): void { this.#sink.itemChanged(item); }

  source(key: keyof typeof BUILT_IN_SOURCES): FeedSource {
    const { ref, kind, label } = BUILT_IN_SOURCES[key];
    return this.#state.feedSources.ensure({ ref, kind, label, level: 'normal' });
  }

  /** 手动添加一条信息流条目 (inside the caller's transaction; the stream hears of it after commit). */
  addManual(input: ManualItem, timeZone: string, after: AfterCommit): FeedItem {
    const now = this.#now();
    const { item, created } = this.#store({
      sourceId: this.source('manual').id,
      origin: 'manual',
      title: input.title,
      url: input.url ?? null,
      summary: input.summary ?? '',
      why: input.why ?? '',
      concernId: null,
      dedupeKey: `manual:${input.requestId}`,
      day: localDay(now, timeZone),
      arrivedAt: now.toISOString(),
    });
    if (created) {
      after(() => this.#sink.itemChanged(item));
    }
    return item;
  }

  react(id: string, version: number, reaction: FeedItem['reaction'], after: AfterCommit): FeedItem {
    const item = this.#state.feedItems.update(id, version, { reaction });
    after(() => this.#sink.itemChanged(item));
    return item;
  }

  save(id: string, version: number, saved: boolean, after: AfterCommit): FeedItem {
    const current = this.#state.feedItems.require(id);
    const savedAt = saved ? (current.savedAt ?? this.#now().toISOString()) : null;
    const item = this.#state.feedItems.update(id, version, { savedAt });
    after(() => this.#sink.itemChanged(item));
    return item;
  }

  /** 「信息流 n 条新的」 of the user's day. */
  newToday(timeZone: string): number {
    const { start, end } = dayRange(localDay(this.#now(), timeZone), timeZone);
    return this.#state.feedItems.countArrivedSince(start.toISOString(), end.toISOString());
  }

  /** 手动添加的写入边界：链接在这里清洗。 */
  #store(input: FeedItemInput): { item: FeedItem; created: boolean } {
    const url = input.url == null ? null : cleanUrl(input.url);
    return this.#state.feedItems.add({ ...input, url, site: url === null ? null : siteOf(url) });
  }
}
