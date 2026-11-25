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
import { BUILT_IN_SOURCES, checkSourceLinks, safeUrl, siteOf, sourceSearchTerms } from '../daily/index.ts';

export function feedItemLinks(item: Pick<FeedItem, 'id' | 'url'>): Pick<FeedItemView, 'url' | 'site'> {
  const url = safeUrl(item.url);
  return { url, site: url === null ? null : siteOf(url) };
}

export function checkFeedItemView(item: FeedItemView): FeedItemView {
  return { ...item, ...feedItemLinks(item) };
}

export interface FeedImageSigner {
  url(target: string): string;
}

export function feedItemKind(item: Pick<FeedItem, 'origin'>, source: FeedSource | undefined): FeedItemView['kind'] {
  if (item.origin === 'manual') { return 'manual'; }
  if (source?.kind === 'x') { return 'x'; }
  if (source?.kind === 'rss') { return 'rss'; }
  if (source?.kind === 'douyin') { return 'douyin'; }
  if (source?.kind === 'reddit') { return 'reddit'; }
  if (source?.kind === 'xhs') { return 'xhs'; }
  return 'news';
}

function proxied(images: FeedImageSigner | null, raw: string | null): string | null {
  const url = safeUrl(raw);
  return images === null || url === null || !url.startsWith('https://') ? null : images.url(url);
}

export type FeedViewState = Pick<StateService, 'feedSources' | 'feedTranslations' | 'videoWorks'>;

export function feedZhView(row: FeedTranslationRow | undefined): FeedZhView | null {
  if (row === undefined) {
    return null;
  }
  const from = row.lang === null || isSimplifiedChinese(row.lang) ? null : languageName(row.lang);
  return { state: row.state, lang: row.lang, from, title: row.title, text: row.text, digest: row.digest };
}

export function feedVideoView(work: VideoWorkRow | undefined): FeedVideoView | null {
  if (work === undefined) {
    return null;
  }
  return { kind: work.kind, durationSeconds: work.durationSeconds, stage: work.stage,
    points: work.digest?.points ?? [], related: work.digest?.related ?? [] };
}

function bodyView(images: FeedImageSigner | null, body: FeedItem['body']): NonNullable<FeedItemView['body']> | null {
  if (body === null) return null;
  return body.flatMap((block) => {
    if (block.t !== 'img') return [block];
    const src = proxied(images, block.src ?? null);
    return src === null ? [] : [{ ...block, src }];
  });
}

export function feedItemView(state: FeedViewState, item: FeedItem,
  images: FeedImageSigner | null, full = false): FeedItemView {
  const source = state.feedSources.get(item.sourceId);
  const translation = state.feedTranslations.get(item.id);
  const image = proxied(images, item.imageUrl);
  const moreImages = item.moreImages.flatMap((more) => {
    const src = proxied(images, more.url);
    return src === null ? [] : [{ src, ratio: more.ratio }];
  });
  return checkFeedItemView({
    id: item.id,
    origin: item.origin,
    kind: feedItemKind(item, source),
    author: item.author === null ? null
      : { name: item.author, handle: item.authorHandle, avatar: proxied(images, item.avatarUrl) },
    image: image === null ? null : { src: image, ratio: item.imageRatio },
    moreImages,
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
    publishedAt: source?.kind === 'douyin' ? null : item.publishedAt,
    reaction: item.reaction,
    saved: item.savedAt !== null,
    note: item.note,
    migrated: item.migratedDefault,
    version: item.version,
    zh: feedZhView(translation),
    chart: translation?.state === 'done' || translation?.state === 'skipped' ? translation.chart : null,
    video: source?.kind === 'douyin' ? feedVideoView(state.videoWorks.byFeedItem(item.id)) : null,
    places: item.places,
    hasBody: item.body !== null && item.body.length > 0,
    ...(full ? { body: bodyView(images, item.body) } : {}),
  });
}

const BUILT_IN_REFS: ReadonlySet<string> = new Set(Object.values(BUILT_IN_SOURCES).map((source) => source.ref));

export function feedSourceView(source: FeedSource, status?: FeedSourceStatus): FeedSourceView {
  return checkSourceLinks({
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
