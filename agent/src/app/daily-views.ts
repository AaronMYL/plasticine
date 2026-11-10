// 每日设置、信息流 stored rows → their views (shared/api/today.ts, feed.ts). Field selection and joins only.

import {
  FEED_ORIGIN_LABELS,
  type DailySettingsView,
  type FeedItemView,
  type FeedVideoView,
  type FeedSourceView,
} from '../../shared/api/index.ts';
import type { FeedItem, FeedSource } from '../../shared/state.ts';
import { isSimplifiedChinese, languageName, type FeedZhView } from '../../shared/feed-translation.ts';
import type { FeedSourceStatus, FeedTranslationRow, SettingsRead, StateService, VideoWorkRow }
  from '../state/index.ts';
import { BUILT_IN_SOURCES, cleanSourceLinks, safeUrl, siteOf, sourceSearchTerms } from '../daily/index.ts';
import { cleanOutboundJson } from '../outbound.ts';

export function feedItemLinks(item: Pick<FeedItem, 'id' | 'url'>): Pick<FeedItemView, 'url' | 'site'> {
  // 已迁条目重跑时会跳过；旧记录、旧缓存与 SSE 输出也必须清洗，不改写历史记录。
  const url = safeUrl(item.url);
  return { url, site: url === null ? null : siteOf(url) };
}

export function cleanFeedItemView(item: FeedItemView): FeedItemView {
  return { ...cleanOutboundJson(item), ...feedItemLinks(item) };
}

/** 外部图片的代理签名（app/mail-view.ts 那套：服务端签名、/v2/mail-image 代取）；没接上就不给图。 */
export interface FeedImageSigner {
  url(target: string): string;
}

/** 一条从哪一路来（shared FEED_ITEM_KINDS）：按来源的种类推，不单存。 */
export function feedItemKind(item: Pick<FeedItem, 'origin'>, source: FeedSource | undefined): FeedItemView['kind'] {
  if (item.origin === 'manual') { return 'manual'; }
  if (source?.kind === 'x') { return 'x'; }
  if (source?.kind === 'rss') { return 'rss'; }
  if (source?.kind === 'douyin') { return 'douyin'; }
  if (source?.kind === 'reddit') { return 'reddit'; }
  return 'news';
}

function proxied(images: FeedImageSigner | null, raw: string | null): string | null {
  const url = safeUrl(raw);
  return images === null || url === null || !url.startsWith('https://') ? null : images.url(url);
}

export type FeedViewState = Pick<StateService, 'feedSources' | 'feedTranslations' | 'videoWorks'>;

/** 第 8 条：存下的中文。还没排上翻译的（旧条目）是 null，界面照原文显示。 */
export function feedZhView(row: FeedTranslationRow | undefined): FeedZhView | null {
  if (row === undefined) {
    return null;
  }
  const from = row.lang === null || isSimplifiedChinese(row.lang) ? null : languageName(row.lang);
  return { state: row.state, lang: row.lang, from, title: row.title, text: row.text, digest: row.digest };
}

/** 第 9 条：抖音收藏总结来的条目带上视频的样子。 */
export function feedVideoView(work: VideoWorkRow | undefined): FeedVideoView | null {
  if (work === undefined) {
    return null;
  }
  return { kind: work.kind, durationSeconds: work.durationSeconds, stage: work.stage,
    points: work.digest?.points ?? [], related: work.digest?.related ?? [] };
}

export function feedItemView(state: FeedViewState, item: FeedItem,
  images: FeedImageSigner | null): FeedItemView {
  const source = state.feedSources.get(item.sourceId);
  const translation = state.feedTranslations.get(item.id);
  const image = proxied(images, item.imageUrl);
  return cleanFeedItemView({
    id: item.id,
    origin: item.origin,
    kind: feedItemKind(item, source),
    author: item.author === null ? null
      : { name: item.author, handle: item.authorHandle, avatar: proxied(images, item.avatarUrl) },
    image: image === null ? null : { src: image, ratio: item.imageRatio },
    originLabel: FEED_ORIGIN_LABELS[item.origin],
    title: item.title,
    ...feedItemLinks(item),
    summary: item.summary,
    why: item.why,
    topic: item.topic,
    concernId: item.concernId,
    sourceId: item.sourceId,
    sourceLabel: source === undefined ? FEED_ORIGIN_LABELS[item.origin] : feedSourceView(source).label,
    ref: item.ref,
    day: item.day,
    arrivedAt: item.arrivedAt,
    // 旧抖音条目曾把收藏日期写进这里，读视图不再把它当成发布时间。
    publishedAt: source?.kind === 'douyin' ? null : item.publishedAt,
    reaction: item.reaction,
    saved: item.savedAt !== null,
    note: item.note,
    migrated: item.migratedDefault,
    version: item.version,
    zh: feedZhView(translation),
    chart: translation?.state === 'done' || translation?.state === 'skipped' ? translation.chart : null,
    video: source?.kind === 'douyin' ? feedVideoView(state.videoWorks.byFeedItem(item.id)) : null,
  });
}

const BUILT_IN_REFS: ReadonlySet<string> = new Set(Object.values(BUILT_IN_SOURCES).map((source) => source.ref));

export function feedSourceView(source: FeedSource, status?: FeedSourceStatus): FeedSourceView {
  return cleanSourceLinks({
    id: source.id,
    kind: source.kind,
    label: source.label,
    query: source.query,
    searchTerms: source.kind === 'interest' ? sourceSearchTerms(source) : [],
    level: source.level,
    concernId: source.concernId,
    ...(source.ref !== null && BUILT_IN_REFS.has(source.ref) ? { ref: source.ref } : {}),
    ...(status === undefined ? {} : { status: { checkedAt: status.checkedAt, okAt: status.okAt,
      error: status.error } }),
    migrated: source.migratedDefault,
    version: source.version,
  });
}

export function settingsView(read: SettingsRead): DailySettingsView {
  return { ...read.settings, version: read.version };
}
