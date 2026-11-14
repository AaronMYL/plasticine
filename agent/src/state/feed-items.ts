// 信息流条目（M4）。一件事一条：同一个 dedupe key 再加一次拿回原来那条，所以收集、迁移重跑都不会出两条。
// 不感兴趣（dislike）的条目不删，列表默认不显示；以前站内扫描写的任务、项目条目也不删，列表里不出现。

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
import { cleanLinkData, cleanUrl, safeUrl, siteOf } from '../daily/index.ts';
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
    const cleaned = cleanLinkData(values);
    if ('url' in values || 'site' in values) {
      const url = typeof values['url'] === 'string' ? cleanUrl(values['url']) : null;
      return { ...cleaned, url, site: url === null ? null : siteOf(url) };
    }
    return cleaned;
  },
};

const NEWEST_FIRST = 'arrived_at DESC, id DESC';
// 信息流页的列表：按天、同一天里命中关注点（concern_id 有值）的在前、再按到达新的在前。规则和客户端用的比较函数在
// shared/feed-order.ts，两边要一起改。
const LIST_ORDER = 'day DESC, (concern_id IS NOT NULL) DESC, arrived_at DESC, id DESC';
// 列表、计数、最近来源和关切线索都只看站外的和手动加的（FEED_LIST_ORIGINS）；不感兴趣的另由 includeHidden 决定。
// 删了的来源（迁移 0113）：它没收藏过的条目不再列，收藏过的留着。
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
  /** Include the items marked 不感兴趣. */
  includeHidden?: boolean;
  /** true：只要信息流收藏（saved_at 有值）；false 或不给：不按收藏筛。 */
  saved?: boolean;
  /** 第 3 批页头分段：只要 X / 订阅 / 新闻（shared FEED_ITEM_KINDS 的推法）。 */
  kind?: (typeof FEED_FILTER_KINDS)[number];
  /** 第 7 批第 10 条：第二栏点一个订阅 / Reddit 版块，只看这一个来源。 */
  sourceId?: string;
  /** 第13批：只看在这一处看到的（X 的关注 / 推荐 / 书签，小红书的推荐 / 收藏）。 */
  place?: FeedPlace;
}

// 分段筛选：X、订阅、Reddit、抖音按来源的种类；新闻是其余站外收集的（手动添加的 origin 是 manual，不算）。
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
    /** 反应按当前值计分：取消或切换反应会自然撤销上一次的分数，不重复累加。 */
    reactionScores(since: string): Map<string, number> {
      const rows = context.db.all(`SELECT source_id, sum(CASE reaction WHEN 'like' THEN 1 ELSE -2 END) AS score
        FROM feed_items WHERE reaction IS NOT NULL AND reaction_at >= $since GROUP BY source_id`, { since });
      return new Map(rows.map((row) => [String(row['source_id']), Number(row['score'])]));
    },
    /** 包括已隐藏、已看过和迁移条目，URL 清洗后再比对，不能只查新抓取器的 dedupe key。 */
    knownUrls(): Set<string> {
      const urls = new Set<string>();
      for (const row of context.db.all('SELECT DISTINCT url FROM feed_items WHERE url IS NOT NULL')) {
        const url = safeUrl(String(row['url']));
        if (url !== null) { urls.add(url); }
      }
      return urls;
    },
    byDedupeKey,
    /**
     * 同一条（dedupe key 一样）再来拿回原来那条；第13批：在另一处又看到的把那一处并进去，以前没存全文的补上全文。
     */
    add(input: FeedItemInput, options: CreateOptions = {}): AddedFeedItem {
      return context.db.transaction(() => {
        const existing = byDedupeKey(input.dedupeKey);
        if (existing !== undefined) {
          const more = (input.places ?? []).filter((place) => !existing.places.includes(place));
          const body = existing.body === null && (input.body ?? null) !== null ? input.body : undefined;
          if (more.length === 0 && body === undefined) return { item: existing, created: false };
          return { item: store.update(existing.id, existing.version, {
            ...(more.length === 0 ? {} : { places: [...existing.places, ...more] }),
            ...(body === undefined ? {} : { body }) }), created: false };
        }
        return { item: store.create(input, undefined, cleanLinkData(options)), created: true };
      });
    },
    /** Newest first (回来时的汇总按它读到更早的为止、关切的线索也按它)。 */
    page(filter: FeedPageFilter, page: Page): FeedItem[] {
      const { where, params } = whereOf(filter);
      return store.select(where, params, page, NEWEST_FIRST);
    },
    /** 信息流页的列表：命中关注点的在同一天里排前面（shared/feed-order.ts）。 */
    listPage(filter: FeedPageFilter, page: Page): FeedItem[] {
      const { where, params } = whereOf(filter);
      return store.select(where, params, page, LIST_ORDER);
    },
    /** Items shown in the feed that arrived at or after `since` (「信息流 n 条新的」). */
    countArrivedSince(since: string, before?: string): number {
      const end = before === undefined ? '' : ' AND arrived_at < $before';
      const row = context.db.get(
        `SELECT count(*) AS n FROM feed_items WHERE arrived_at >= $since AND ${SHOWN}${end}`,
        { since, ...(before === undefined ? {} : { before }) },
      );
      return Number(row?.['n'] ?? 0);
    },
    /** 第 8 条第二栏：[from, before) 里进来的、显示着的条目按来路数（x / rss / news / douyin / manual）。 */
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
    /** 这个来源一共收过几条（不管看没看、隐没隐藏）：博客收得少时再往前多导入几篇（第13批）。 */
    countForSource(sourceId: string): number {
      return Number(context.db.get('SELECT count(*) AS n FROM feed_items WHERE source_id = $source',
        { source: sourceId })?.['n'] ?? 0);
    },
    /** 第13批：一个来源（X、小红书）[from, before) 里进来的、显示着的条目按在哪一处看到的数。 */
    countByPlace(sourceId: string, from: string, before: string): Partial<Record<FeedPlace, number>> {
      const rows = context.db.all(`SELECT p.value AS place, count(*) AS n
        FROM feed_items, json_each(feed_items.places) p
        WHERE source_id = $source AND arrived_at >= $from AND arrived_at < $before AND ${SHOWN}
        GROUP BY p.value`, { source: sourceId, from, before });
      return Object.fromEntries(rows.map((row) => [String(row['place']), Number(row['n'])]));
    },
    /** 第 7 批第 10 条第二栏每个来源一行：[from, before) 里进来的、显示着的条目按来源数。 */
    countBySource(from: string, before: string): Map<string, number> {
      const rows = context.db.all(`SELECT source_id, count(*) AS n FROM feed_items
        WHERE arrived_at >= $from AND arrived_at < $before AND ${SHOWN} GROUP BY source_id`, { from, before });
      return new Map(rows.map((row) => [String(row['source_id']), Number(row['n'])]));
    },
    /** The newest item a concern brought back (探索方向的「最近的线索」). */
    latestForConcern: (concernId: string): FeedItem | undefined =>
      store.select(`concern_id = $concern_id AND ${SHOWN}`, { concern_id: concernId }, { limit: 1 }, NEWEST_FIRST)[0],
    /** Sites with how many shown items each, most first (信息源的「最近来源」). */
    recentSites(limit: number): { site: string; count: number }[] {
      // 旧 site 可能是完整 URL，甚至与 url 不一致。先清洗 url，再按 host 合并计数，最后取前 limit 个。
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
