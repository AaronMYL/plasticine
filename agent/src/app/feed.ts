// /v2/feed: 信息流页——条目（按天新的在前、同一天里命中关注点的在前，不感兴趣的默认不显示，可只看收藏）、反应（赞 / 不感兴趣 / 收藏）、手动添加条目、信息源
// （关注点、不要的、最近来源）、加关注点（同时在关切板上开一条探索方向）、调来源的多少。写操作按 requestId 幂等，带 version
// 的过时就 409 带现在的那一条；提交之后才推事件。

import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  AddFeedItemRequestSchema,
  AddSubscriptionRequestSchema,
  AddInterestRequestSchema,
  DEFAULT_TIME_ZONE,
  FeedListQuerySchema,
  FeedItemViewSchema,
  FEED_NAV_LABELS,
  FEED_NAV_SOURCES,
  FeedNavQuerySchema,
  type FeedNavResponse,
  FeedSourceViewSchema,
  ReactFeedItemRequestSchema,
  RECENT_SITES_MAX,
  SaveFeedItemRequestSchema,
  SetSourceLevelRequestSchema,
  SetSourceQueryRequestSchema,
  COGNITION_PAGE_DEFAULT,
  type FeedItemResponse,
  type FeedItemView,
  type FeedListResponse,
  type FeedSourceResponse,
  type FeedSourcesResponse,
  type InterestResponse,
} from '../../shared/api/index.ts';
import {
  cleanLinkData,
  cleanSourceLinks,
  dayRange,
  FEED_SOURCE_EVERY_MS,
  localDay,
  RETIRED_SOURCE_REFS,
  siteOf,
  sourceSearchTerms,
} from '../daily/index.ts';
import type { FeedItem, FeedSource } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { cleanFeedItemView, feedItemKind, feedItemView, feedSourceView } from './daily-views.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

// 加订阅时找订阅地址最多等这么久（页面本身 + 声明的订阅 + 几个常见路径，共用一个时限）。
const DISCOVER_TIMEOUT_MS = 15_000;

/** A version conflict answered with the row as it is now. */
function withCurrent<T>(write: () => T, current: () => unknown, currentVersion: () => number): T {
  try {
    return write();
  } catch (error) {
    if (!(error instanceof StateError) || error.code !== 'version_conflict') {
      throw error;
    }
    throw new ApiError(409, 'version_conflict', '这一条在别处改过了，这次没有改。', {
      currentVersion: currentVersion(),
      next: '看 current 里的最新版，确认后用最新的 version 再来。',
      extra: { current: current() },
    });
  }
}

/** 一条的视图：配图和头像换成服务端代理地址（邮件图片那套签名，app/mail-view.ts）。 */
/** 信息流条目变了（新来的、评论、收藏）：提交之后推给每条打开的事件流。 */
export function attachFeedStreams(deps: AppDeps): void {
  deps.daily.feed.attach({
    itemChanged: (item) => deps.hub.publish({ type: 'feed_item_changed', item: itemView(deps, item) }),
  });
}

export function itemView(deps: Pick<AppDeps, 'state' | 'm5b'>, item: FeedItem): FeedItemView {
  return feedItemView(deps.state, item, deps.m5b.mailImages.signer);
}

function itemWrite<T>(deps: AppDeps, id: string, write: () => T): T {
  const read = () => deps.state.feedItems.require(id);
  return withCurrent(write, () => itemView(deps, read()), () => read().version);
}

/** 旧缓存会绕过视图构造；条目、来源和冲突快照统一清洗，不重做动作或改写缓存。 */
const PRE_SEARCH_SOURCE_SCHEMA = Type.Omit(FeedSourceViewSchema, ['searchTerms']);
// 第 3 批之前的条目回执还没有 kind / author / image：补上（kind 按存的来源推，没有图），不重做操作。
const PRE_CARD_ITEM_SCHEMA = Type.Omit(FeedItemViewSchema, ['kind', 'author', 'image']);

function cleanFeedReply(context: RequestContext, reply: Reply): Reply {
  if (typeof reply.body !== 'object' || reply.body === null) {
    return reply;
  }
  const body: Record<string, unknown> = cleanLinkData({ ...reply.body });
  for (const key of ['item', 'source', 'current']) {
    const item = body[key];
    if (Value.Check(FeedItemViewSchema, item)) {
      body[key] = cleanFeedItemView(item);
    } else if (Value.Check(PRE_CARD_ITEM_SCHEMA, item)) {
      const source = context.deps.state.feedSources.get(item.sourceId);
      body[key] = cleanFeedItemView({ ...item, kind: feedItemKind(item, source), author: null, image: null });
    } else if (Value.Check(FeedSourceViewSchema, item)) {
      body[key] = cleanSourceLinks(item);
    } else if (Value.Check(PRE_SEARCH_SOURCE_SCHEMA, item)) {
      // 升级前的回执还没有 searchTerms；补齐新视图，但不重做操作或改写旧缓存。
      const stored = context.deps.state.feedSources.get(item.id);
      const terms = stored === undefined ? [item.query ?? item.label]
        : sourceSearchTerms({ ...stored, label: item.label, query: item.query });
      body[key] = cleanSourceLinks({ ...item, searchTerms: item.kind === 'interest' ? terms : [] });
    }
  }
  return { ...reply, body };
}

/** GET /v2/feed/items/:id：条目直达不受列表的日期、收藏和不感兴趣筛选影响。 */
export function getFeedItem(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const body: FeedItemResponse = { item: itemView(context.deps, state.feedItems.require(param(context, 'id'))) };
  return { status: 200, body };
}

/** GET /v2/feed?day=&origin=&includeHidden=&saved=&tz=&limit=&offset= */
export function listFeed(context: RequestContext): Reply {
  requireAuth(context);
  const types = { limit: 'integer', offset: 'integer', includeHidden: 'boolean', saved: 'boolean' } as const;
  const query = checkInput(FeedListQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const { state, daily } = context.deps;
  const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
  const offset = query.offset ?? 0;
  const timeZone = query.tz ?? DEFAULT_TIME_ZONE;
  // A day is the user's: its local midnights in the request's zone, matched against arrivedAt — the same bounds the
  // 「n 条新的」 count uses, so the list and the count agree across midnight (M4 审查 P2).
  const range = query.day === undefined ? undefined : dayRange(query.day, timeZone);
  const filter = {
    ...(range === undefined ? {} : { arrivedFrom: range.start.toISOString(), arrivedBefore: range.end.toISOString() }),
    ...(query.origin === undefined ? {} : { origin: query.origin }),
    ...(query.includeHidden === undefined ? {} : { includeHidden: query.includeHidden }),
    ...(query.saved === undefined ? {} : { saved: query.saved }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
  };
  // One more than asked shows whether another page follows.
  const page = state.feedItems.listPage(filter, { limit: limit + 1, offset });
  const body: FeedListResponse = {
    items: page.slice(0, limit).map((item) => itemView(context.deps, item)),
    nextOffset: page.length > limit ? offset + limit : null,
    newToday: daily.feed.newToday(timeZone),
  };
  return { status: 200, body };
}

/**
 * GET /v2/feed/nav?tz= — 第二栏：全部 / 订阅 / 来源，带今天新来的个数。订阅那一节由订阅那条线填（第 6 批 subs 线），
 * 这里先给空数组。
 */
export function feedNav(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(FeedNavQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const timeZone = query.tz ?? DEFAULT_TIME_ZONE;
  const { start, end } = dayRange(localDay(context.deps.now(), timeZone), timeZone);
  const counts = context.deps.state.feedItems.countByKind(start.toISOString(), end.toISOString());
  const sources = FEED_NAV_SOURCES.map((key) => ({ key, label: FEED_NAV_LABELS[key],
    count: key === 'saved' ? null : counts[key] }));
  const body: FeedNavResponse = {
    all: counts.x + counts.rss + counts.news + counts.douyin + counts.manual,
    subscriptions: [],
    sources,
  };
  return { status: 200, body };
}

/** GET /v2/feed/sources */
export function listFeedSources(context: RequestContext): Reply {
  requireAuth(context);
  const { state, daily } = context.deps;
  // 第 3 批：X 和「按关注点搜新闻」两行一直在（设置里能开关）；第一次列来源时建出来。
  daily.subscriptions.builtIn('x');
  daily.subscriptions.builtIn('news');
  const sources = state.feedSources.all();
  const statuses = state.feedSourceStatus.all();
  const view = (source: FeedSource) => feedSourceView(source, statuses.get(source.id));
  const body: FeedSourcesResponse = {
    interests: sources.filter((source) => source.kind === 'interest').map(view),
    blocked: sources.filter((source) => source.kind === 'blocked_site').map(view),
    // 任务、项目两个站内来源停了（信息流只放站外资讯），不再列在「其他来源」里；手动添加、订阅、X 留着。
    others: sources.filter((source) => (source.kind === 'internal' || source.kind === 'rss' || source.kind === 'x')
      && (source.ref === null || !RETIRED_SOURCE_REFS.includes(source.ref))).map(view),
    everyMinutes: FEED_SOURCE_EVERY_MS / 60_000,
    recentSites: state.feedItems.recentSites(RECENT_SITES_MAX),
  };
  return { status: 200, body };
}

/** 网站地址和直接订阅地址共用发现入口，抓取是只读；完成后写入仍走会话重验和幂等。 */
export async function addSubscription(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(AddSubscriptionRequestSchema, raw.value, '加订阅');
  const options = { bodyDigest: raw.digest };
  const previous = context.deps.state.apiRequests.find(body.requestId);
  if (previous !== undefined && Date.parse(previous.expiresAt) > context.deps.now().getTime()) {
    return cleanFeedReply(context, idempotent(context, body.requestId, () => {
      throw new ApiError(410, 'result_expired', '回执刚刚过期，请重新添加订阅。');
    }, options));
  }
  const external = context.deps.daily.externalFeed;
  if (external === null) {
    throw new ApiError(503, 'not_configured', '订阅抓取还没接上，请稍后再试。');
  }
  const found = await external.discover(body.url, AbortSignal.timeout(DISCOVER_TIMEOUT_MS));
  const label = body.label?.trim() || found.title || siteOf(found.url);
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const source = context.deps.state.feedSources.ensure({ kind: 'rss', label: label.slice(0, 200),
      query: found.url, level: 'normal', ref: `rss:${createHash('sha256').update(found.url).digest('hex')}` });
    // 加上就抓一次，不等下一个两小时。
    afterCommit(() => { context.deps.daily.subscriptions.scan(); });
    return { status: 201, body: { source: feedSourceView(source) } };
  }, options));
}

/** POST /v2/feed/items — 手动添加一条信息流条目。 */
export async function addFeedItem(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(AddFeedItemRequestSchema, await readJsonBody(context.req), '添加条目');
  const tz = context.url.searchParams.get('tz') ?? DEFAULT_TIME_ZONE;
  const { deps } = context;
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const item = deps.daily.feed.addManual(body, tz, afterCommit);
    const response: FeedItemResponse = { item: itemView(deps, item) };
    return { status: 201, body: response };
  }));
}

/** POST /v2/feed/items/:id/reaction */
export async function reactFeedItem(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ReactFeedItemRequestSchema, await readJsonBody(context.req), '反应');
  const id = param(context, 'id');
  const { deps } = context;
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const item = itemWrite(deps, id, () => deps.daily.feed.react(id, body.version, body.reaction, afterCommit));
    const response: FeedItemResponse = { item: itemView(deps, item) };
    return { status: 200, body: response };
  }));
}

/**
 * POST /v2/feed/items/:id/save：信息流收藏只记在这一条上（saved_at），在信息流的「收藏」筛选里看。2026-11-04 用户定：
 * 信息流收藏归信息流、网页收藏归书签，两边分开——不再同时加书签（第 110 条的「收藏就是加书签」到此为止）。
 */
export async function saveFeedItem(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SaveFeedItemRequestSchema, await readJsonBody(context.req), '收藏');
  const id = param(context, 'id');
  const { deps } = context;
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const item = itemWrite(deps, id, () => deps.daily.feed.save(id, body.version, body.saved, afterCommit));
    const response: FeedItemResponse = { item: itemView(deps, item) };
    return { status: 200, body: response };
  }));
}

/** POST /v2/feed/sources — 加关注点。 */
export async function addInterest(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(AddInterestRequestSchema, await readJsonBody(context.req), '加关注点');
  const { deps } = context;
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const query = body.query === undefined ? {} : { query: body.query };
    const { source } = deps.daily.interests.add({ label: body.label, ...query });
    const response: InterestResponse = { source: feedSourceView(source) };
    return { status: 201, body: response };
  }));
}

/** POST /v2/feed/sources/:id/level */
export async function setSourceLevel(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SetSourceLevelRequestSchema, await readJsonBody(context.req), '来源多少');
  const id = param(context, 'id');
  const { deps } = context;
  return cleanFeedReply(context, idempotent(context, body.requestId, () => {
    const read = () => deps.state.feedSources.require(id);
    const source = withCurrent(
      () => deps.daily.interests.setLevel(id, body.version, body.level),
      () => feedSourceView(read()),
      () => read().version,
    );
    const response: FeedSourceResponse = { source: feedSourceView(source) };
    return { status: 200, body: response };
  }));
}

/** POST /v2/feed/sources/:id/query：用户定制查询后保持整句，不再按名字拆词。 */
export async function setSourceQuery(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(SetSourceQueryRequestSchema, raw.value, '搜索词');
  const id = param(context, 'id');
  const { state } = context.deps;
  return cleanFeedReply(context, idempotent(context, body.requestId, () => {
    const read = () => state.feedSources.require(id);
    if (read().kind !== 'interest') {
      throw new ApiError(400, 'invalid_request', '只有关注点能改搜索词，请回到关注点那一行。');
    }
    const source = withCurrent(() => state.feedSources.update(id, body.version,
      { query: body.query.trim(), queryEdited: true }), () => feedSourceView(read()), () => read().version);
    return { status: 200, body: { source: feedSourceView(source) } };
  }, { bodyDigest: raw.digest }));
}
