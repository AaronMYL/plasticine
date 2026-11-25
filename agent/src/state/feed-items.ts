import {
  FEED_FILTER_KINDS,
  FEED_LIST_ORIGINS,
  FeedItemInputSchema,
  FeedItemPatchSchema,
  FeedItemSchema,
  type CreateOptions,
  type FeedItem,
  type FeedItemInput,
  type FeedItemPatch,
  type FeedPlace,
  type Page,
} from '../../shared/state.ts';
import type { Params } from './db.ts';
import { checkLinkData, checkUrl, linkKey, safeUrl, siteOf } from '../daily/index.ts';
import { OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  sourceId: 'text',
  origin: 'text',
  title: 'text',
  url: 'text',
  site: 'text',
  summary: 'text',
  why: 'text',
  topic: 'text',
  concernId: 'text',
  ref: 'text',
  dedupeKey: 'text',
  day: 'text',
  publishedAt: 'text',
  arrivedAt: 'text',
  reaction: 'text',
  savedAt: 'text',
  note: 'text',
  seenAt: 'text',
  author: 'text',
  authorHandle: 'text',
  avatarUrl: 'text',
  imageUrl: 'text',
  imageRatio: 'real',
  moreImages: 'json',
  places: 'json',
  body: 'json',
};

const DEFAULTS = {
  url: null,
  site: null,
  summary: '',
  why: '',
  topic: null,
  concernId: null,
  ref: null,
  publishedAt: null,
  reaction: null,
  savedAt: null,
  note: null,
  seenAt: null,
  author: null,
  authorHandle: null,
  avatarUrl: null,
  imageUrl: null,
  imageRatio: null,
  moreImages: [],
  places: [],
  body: null,
};

const SPEC: StoreSpec<typeof FeedItemSchema, typeof FeedItemInputSchema, typeof FeedItemPatchSchema> = {
  table: 'feed_items',
  searchSource: 'feed_item',
  schema: FeedItemSchema,
  input: FeedItemInputSchema,
  patch: FeedItemPatchSchema,
  columns: COLUMNS,
  defaults: DEFAULTS,
  derive(values) {
    const cleaned = checkLinkData(values);
    if ('url' in values || 'site' in values) {
      const url = typeof values['url'] === 'string' ? checkUrl(values['url']) : null;
      return { ...cleaned, url, site: url === null ? null : siteOf(url) };
    }
    return cleaned;
  },
};

function fuller(existing: string | null, incoming: string | null): string | null {
  const old = safeUrl(existing);
  const next = safeUrl(incoming);
  if (old === null || next === null || old === next) return null;
  const was = new URL(old);
  const now = new URL(next);
  if (was.origin !== now.origin || was.pathname !== now.pathname) return null;
  const kept = [...was.searchParams].every(([name, value]) => now.searchParams.getAll(name).includes(value));
  return kept && [...now.searchParams].length > [...was.searchParams].length ? next : null;
}

const NEWEST_FIRST = 'arrived_at DESC, id DESC';
const LIST_ORDER = 'day DESC, (concern_id IS NOT NULL) DESC, arrived_at DESC, id DESC';
const FROM_LIVE_SOURCE = `(saved_at IS NOT NULL
  OR source_id NOT IN (SELECT id FROM feed_sources WHERE removed_at IS NOT NULL))`;
const LISTED = `origin IN (${FEED_LIST_ORIGINS.map((origin) => `'${origin}'`).join(', ')}) AND ${FROM_LIVE_SOURCE}`;
const SHOWN = `${LISTED} AND (reaction IS NULL OR reaction <> 'dislike')`;

export interface FeedPageFilter {
  /** Arrived in [arrivedFrom, arrivedBefore): a user's day as instants (daily/days.ts dayRange), not the stored day. */
  arrivedFrom?: string;
  arrivedBefore?: string;
  origin?: FeedItem['origin'];
  concernId?: string;
  includeHidden?: boolean;
  saved?: boolean;
  kind?: (typeof FEED_FILTER_KINDS)[number];
  sourceId?: string;
  place?: FeedPlace;
}

const KIND_CLAUSES: Readonly<Record<(typeof FEED_FILTER_KINDS)[number], string>> = {
  x: "source_id IN (SELECT id FROM feed_sources WHERE kind = 'x')",
  rss: "source_id IN (SELECT id FROM feed_sources WHERE kind = 'rss')",
  news: `origin = 'feed' AND source_id NOT IN (SELECT id FROM feed_sources
    WHERE kind IN ('x', 'rss', 'douyin', 'reddit', 'xhs'))`,
  douyin: "source_id IN (SELECT id FROM feed_sources WHERE kind = 'douyin')",
  reddit: "source_id IN (SELECT id FROM feed_sources WHERE kind = 'reddit')",
  xhs: "source_id IN (SELECT id FROM feed_sources WHERE kind = 'xhs')",
};
const IN_PLACE = 'EXISTS (SELECT 1 FROM json_each(places) WHERE value = $place)';

export interface AddedFeedItem {
  item: FeedItem;
  created: boolean;
}

function whereOf(filter: FeedPageFilter): { where: string; params: Params } {
  const clauses: string[] = [];
  const params: Params = {};
  if (filter.arrivedFrom !== undefined) {
    clauses.push('arrived_at >= $arrived_from');
    params['arrived_from'] = filter.arrivedFrom;
  }
  if (filter.arrivedBefore !== undefined) {
    clauses.push('arrived_at < $arrived_before');
    params['arrived_before'] = filter.arrivedBefore;
  }
  if (filter.origin !== undefined) {
    clauses.push('origin = $origin');
    params['origin'] = filter.origin;
  }
  if (filter.concernId !== undefined) {
    clauses.push('concern_id = $concern_id');
    params['concern_id'] = filter.concernId;
  }
  if (filter.saved === true) {
    clauses.push('saved_at IS NOT NULL');
  }
  if (filter.kind !== undefined) {
    clauses.push(KIND_CLAUSES[filter.kind]);
  }
  if (filter.sourceId !== undefined) {
    clauses.push('source_id = $source_id');
    params['source_id'] = filter.sourceId;
  }
  if (filter.place !== undefined) {
    clauses.push(IN_PLACE);
    params['place'] = filter.place;
  }
  clauses.push(filter.includeHidden === true ? LISTED : SHOWN);
  return { where: clauses.join(' AND '), params };
}

export function createFeedItemStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function byDedupeKey(dedupeKey: string): FeedItem | undefined {
    return store.select('dedupe_key = $dedupe_key', { dedupe_key: dedupeKey })[0];
  }

  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    update(id: string, version: number, patch: FeedItemPatch): FeedItem {
      return context.db.transaction(() => {
        const item = store.update(id, version, patch);
        if ('reaction' in patch) {
          context.db.run('UPDATE feed_items SET reaction_at = $at WHERE id = $id', { id, at: context.now() });
        }
        return item;
      });
    },
    reactionSummary(since: string): { title: string; source: string; reaction: string }[] {
      const rows = context.db.all(`SELECT i.title, s.label AS source, i.reaction FROM feed_items i
        JOIN feed_sources s ON s.id = i.source_id WHERE i.reaction IS NOT NULL AND i.reaction_at >= $since
        ORDER BY i.reaction_at DESC`, { since });
      return rows.map((row) => ({ title: String(row['title']), source: String(row['source']),
        reaction: String(row['reaction']) }));
    },
    reactionScores(since: string): Map<string, number> {
      const rows = context.db.all(`SELECT source_id, sum(CASE reaction WHEN 'like' THEN 1 ELSE -2 END) AS score
        FROM feed_items WHERE reaction IS NOT NULL AND reaction_at >= $since GROUP BY source_id`, { since });
      return new Map(rows.map((row) => [String(row['source_id']), Number(row['score'])]));
    },
    knownUrls(): Set<string> {
      const urls = new Set<string>();
      for (const row of context.db.all('SELECT DISTINCT url FROM feed_items WHERE url IS NOT NULL')) {
        const url = safeUrl(String(row['url']));
        if (url !== null) { urls.add(linkKey(url)); }
      }
      return urls;
    },
    byDedupeKey,
    add(input: FeedItemInput, options: CreateOptions = {}): AddedFeedItem {
      return context.db.transaction(() => {
        const existing = byDedupeKey(input.dedupeKey);
        if (existing !== undefined) {
          const more = (input.places ?? []).filter((place) => !existing.places.includes(place));
          const body = existing.body === null && (input.body ?? null) !== null ? input.body : undefined;
          const url = fuller(existing.url, input.url ?? null);
          const images = existing.moreImages.length > 0 ? []
            : (input.moreImages ?? []).filter((image) => image.url !== existing.imageUrl);
          if (more.length === 0 && body === undefined && url === null && images.length === 0) {
            return { item: existing, created: false };
          }
          return { item: store.update(existing.id, existing.version, {
            ...(more.length === 0 ? {} : { places: [...existing.places, ...more] }),
            ...(body === undefined ? {} : { body }), ...(url === null ? {} : { url }),
            ...(images.length === 0 ? {} : { moreImages: images }) }), created: false };
        }
        return { item: store.create(input, undefined, checkLinkData(options)), created: true };
      });
    },
    page(filter: FeedPageFilter, page: Page): FeedItem[] {
      const { where, params } = whereOf(filter);
      return store.select(where, params, page, NEWEST_FIRST);
    },
    listPage(filter: FeedPageFilter, page: Page): FeedItem[] {
      const { where, params } = whereOf(filter);
      return store.select(where, params, page, LIST_ORDER);
    },
    countArrivedSince(since: string, before?: string): number {
      const end = before === undefined ? '' : ' AND arrived_at < $before';
      const row = context.db.get(
        `SELECT count(*) AS n FROM feed_items WHERE arrived_at >= $since AND ${SHOWN}${end}`,
        { since, ...(before === undefined ? {} : { before }) },
      );
      return Number(row?.['n'] ?? 0);
    },
    countByKind(from: string, before: string): Record<(typeof FEED_FILTER_KINDS)[number] | 'manual', number> {
      const counts = { x: 0, rss: 0, news: 0, douyin: 0, reddit: 0, xhs: 0, manual: 0 };
      const range = { from, before };
      const span = 'arrived_at >= $from AND arrived_at < $before';
      for (const kind of FEED_FILTER_KINDS) {
        const row = context.db.get(`SELECT count(*) AS n FROM feed_items WHERE ${span} AND ${SHOWN}
          AND ${KIND_CLAUSES[kind]}`, range);
        counts[kind] = Number(row?.['n'] ?? 0);
      }
      const manual = context.db.get(`SELECT count(*) AS n FROM feed_items WHERE ${span} AND ${SHOWN}
        AND origin = 'manual'`, range);
      counts.manual = Number(manual?.['n'] ?? 0);
      return counts;
    },
    countForSource(sourceId: string): number {
      return Number(context.db.get('SELECT count(*) AS n FROM feed_items WHERE source_id = $source',
        { source: sourceId })?.['n'] ?? 0);
    },
    countByPlace(sourceId: string, from: string, before: string): Partial<Record<FeedPlace, number>> {
      const rows = context.db.all(`SELECT p.value AS place, count(*) AS n
        FROM feed_items, json_each(feed_items.places) p
        WHERE source_id = $source AND arrived_at >= $from AND arrived_at < $before AND ${SHOWN}
        GROUP BY p.value`, { source: sourceId, from, before });
      return Object.fromEntries(rows.map((row) => [String(row['place']), Number(row['n'])]));
    },
    countBySource(from: string, before: string): Map<string, number> {
      const rows = context.db.all(`SELECT source_id, count(*) AS n FROM feed_items
        WHERE arrived_at >= $from AND arrived_at < $before AND ${SHOWN} GROUP BY source_id`, { from, before });
      return new Map(rows.map((row) => [String(row['source_id']), Number(row['n'])]));
    },
    latestForConcern: (concernId: string): FeedItem | undefined =>
      store.select(`concern_id = $concern_id AND ${SHOWN}`, { concern_id: concernId }, { limit: 1 }, NEWEST_FIRST)[0],
    recentSites(limit: number): { site: string; count: number }[] {
      const sql = `SELECT url, count(*) AS n FROM feed_items WHERE url IS NOT NULL AND ${SHOWN} GROUP BY url`;
      const counts = new Map<string, number>();
      for (const row of context.db.all(sql)) {
        const url = safeUrl(String(row['url']));
        if (url !== null) {
          const site = siteOf(url);
          counts.set(site, (counts.get(site) ?? 0) + Number(row['n']));
        }
      }
      return [...counts].map(([site, count]) => ({ site, count }))
        .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site)).slice(0, limit);
    },
  };
}

export type FeedItemStore = ReturnType<typeof createFeedItemStore>;
