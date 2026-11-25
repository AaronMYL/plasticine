import type { FeedItem, FeedItemInput, FeedSource } from '../../shared/state.ts';
import type { AfterCommit } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { dayRange, localDay } from './days.ts';
import { checkUrl, siteOf } from './urls.ts';

export type FeedState = Pick<StateService, 'feedItems' | 'feedSources'>;

export const BUILT_IN_SOURCES = {
  manual: { ref: 'internal:manual', kind: 'internal', label: '手动添加' },
  x: { ref: 'x:following', kind: 'x', label: 'X' },
  news: { ref: 'internal:news', kind: 'internal', label: '兴趣' },
  xhs: { ref: 'xhs:feed', kind: 'xhs', label: '小红书' },
} as const;

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

  newToday(timeZone: string): number {
    const { start, end } = dayRange(localDay(this.#now(), timeZone), timeZone);
    return this.#state.feedItems.countArrivedSince(start.toISOString(), end.toISOString());
  }

  #store(input: FeedItemInput): { item: FeedItem; created: boolean } {
    const url = input.url == null ? null : checkUrl(input.url);
    return this.#state.feedItems.add({ ...input, url, site: url === null ? null : siteOf(url) });
  }
}
