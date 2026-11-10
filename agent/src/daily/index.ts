// daily/：感知来源（《应用架构方案》第 3 节、structure.md）——信息流、关注点、订阅、书签、站内信。它的数据只经 state/ 写；
// 模型选材由脑注入，RSS 与关注点搜索共用每日七点和手动刷新。2026-11-05 他定：采访、十件事、预测、关切的每日检查删掉。

import { FeedComments } from './feed-comments.ts';
import type { FeedCommentGenerator } from '../../shared/feed-comments.ts';
import type { Scan } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import type { Bookmark, FeedItem } from '../../shared/state.ts';
import { BookmarkDesk } from './bookmarks.ts';
import { FeedDesk } from './feed.ts';
import { InterestDesk } from './interests.ts';
import { ExternalFeed } from './external-feed.ts';
import { FeedSubscriptions } from './feed-subscriptions.ts';
import type { FeedFetcher } from './feed-fetch.ts';
import type { FeedSelector } from '../../shared/feed-selection.ts';
import type { FeedTranslator } from '../../shared/feed-translation.ts';
import { FeedTranslations } from './feed-translate.ts';
export { FeedTranslations, sourceTextOf } from './feed-translate.ts';
export { checkedChart, numbersIn } from './feed-chart-check.ts';
export { FeedFetcher } from './feed-fetch.ts';
export type { DiscoveredFeed } from './feed-fetch.ts';
export { FEED_SOURCE_EVERY_MS, FeedSubscriptions, X_READ_ERROR_TEXT } from './feed-subscriptions.ts';
export { sourceSearchTerms } from './feed-candidates.ts';
export { BookmarkDesk, cleanBookmarkUrl } from './bookmarks.ts';
export type { BookmarkDeskOptions, BookmarkState, NewBookmark } from './bookmarks.ts';
export { BACKGROUND_TIME_ZONE, dayRange, dayStartOf, localDay, localDayStart } from './days.ts';
export { DAILY_ERROR_CODES, DailyError } from './errors.ts';
export type { DailyErrorCode } from './errors.ts';
export { BUILT_IN_SOURCES, FeedDesk, RETIRED_SOURCE_REFS } from './feed.ts';
export type { FeedSink, FeedState, ManualItem } from './feed.ts';
export { InboxDesk, INBOX_PAGE_DEFAULT, PREVIEW_MAX_CHARS, previewOf, replyActionId } from './inbox.ts';
export type { InboxDeskOptions, InboxFlags, InboxSink } from './inbox.ts';
export { InterestDesk } from './interests.ts';
export type { InterestState } from './interests.ts';
export { cleanUrl, cleanUrlQuery, isCredentialParam, siteOf } from './urls.ts';
export { cleanLinkData, cleanLinkText, cleanSite, cleanSourceLinks, safeUrl } from './link-data.ts';

export interface DailyOptions {
  state: StateService;
  now: () => Date;
  externalFeed?: { fetcher: FeedFetcher; select: FeedSelector };
  feedCommentGenerator?: FeedCommentGenerator;
  /** 第 8 条：抓取时翻成中文（「翻译」模型用途）；不给就不翻，条目照原文显示。 */
  feedTranslator?: FeedTranslator;
  feedTranslatorModel?: () => string | null;
  /** 第 102 条：信息流的新条目同时记一条触发（进门）。 */
  onFeedItem?: (item: FeedItem) => void;
  /** 第 110 条：新加的书签也记一条触发。 */
  onBookmark?: (bookmark: Bookmark) => void;
}

export function createDaily(options: DailyOptions) {
  const { state, now } = options;
  const feed = new FeedDesk({ state, now });
  const translations = options.feedTranslator === undefined ? null : new FeedTranslations({
    state, now, translate: options.feedTranslator, changed: (item) => feed.announce(item),
    isPost: (item) => state.feedSources.get(item.sourceId)?.kind === 'x',
    ...(options.feedTranslatorModel === undefined ? {} : { model: options.feedTranslatorModel }),
  });
  const added = (item: FeedItem): void => {
    feed.announce(item);
    translations?.added(item);
    options.onFeedItem?.(item);
  };
  const externalFeed = options.externalFeed === undefined ? null : new ExternalFeed({
    state, now, ...options.externalFeed, onAdded: added,
  });
  // 第 3 批：订阅每 2 小时直接进信息流；X 由 Mac 交来。抓取器没接上时订阅不抓，X 照收。
  const subscriptions = new FeedSubscriptions({ state, now,
    ...(options.externalFeed === undefined ? {} : { fetcher: options.externalFeed.fetcher }),
    onAdded: added });
  const comments = options.feedCommentGenerator === undefined ? null : new FeedComments({ state,
    generate: options.feedCommentGenerator, changed: (item) => feed.announce(item) });
  const interests = new InterestDesk({ state });
  const bookmarks = new BookmarkDesk({ state, now,
    ...(options.onBookmark === undefined ? {} : { onAdded: options.onBookmark }) });
  const scans: Scan[] = [
    { name: '每日外部信息流', run: () => externalFeed?.scan() },
    { name: '信息流订阅', run: () => subscriptions.scan() },
    { name: '信息流评论', run: () => comments?.resume() },
    { name: '信息流翻成中文', run: () => translations?.scan() },
  ];
  return { feed, interests, scans, externalFeed, subscriptions, comments, bookmarks, translations, added };
}

export type Daily = ReturnType<typeof createDaily>;
