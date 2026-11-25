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
  checkLinkData,
  checkSourceLinks,
  checkUrl,
  DailyError,
  dayRange,
  FEED_SOURCE_EVERY_MS,
  handOffText,
  RETIRED_SOURCE_REFS,
  siteOf,
  sourceSearchTerms,
} from '../daily/index.ts';
import { checkPublicHttpsUrl } from '../cloud-tools/index.ts';
import type { FeedItem, FeedSource } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { checkFeedItemView, feedItemKind, feedItemView, feedSourceView } from './daily-views.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';
import { navOf } from './feed-nav.ts';

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

export function attachFeedStreams(deps: AppDeps): void {
  deps.daily.feed.attach({
    itemChanged: (item) => deps.hub.publish({ type: 'feed_item_changed', item: itemView(deps, item) }),
  });
}

export function itemView(deps: Pick<AppDeps, 'state' | 'toolGroups'>, item: FeedItem, full = false): FeedItemView {
  return feedItemView(deps.state, item, deps.toolGroups.mailImages.signer, full);
}

function itemWrite<T>(deps: AppDeps, id: string, write: () => T): T {
  const read = () => deps.state.feedItems.require(id);
  return withCurrent(write, () => itemView(deps, read()), () => read().version);
}

const PRE_SEARCH_SOURCE_SCHEMA = Type.Omit(FeedSourceViewSchema, ['searchTerms']);
const PRE_CARD_ITEM_SCHEMA = Type.Omit(FeedItemViewSchema, ['kind', 'author', 'image']);

function cleanFeedReply(context: RequestContext, reply: Reply): Reply {
  if (typeof reply.body !== 'object' || reply.body === null) {
    return reply;
  }
  const body: Record<string, unknown> = checkLinkData({ ...reply.body });
  for (const key of ['item', 'source', 'current']) {
    const item = body[key];
    if (Value.Check(FeedItemViewSchema, item)) {
      body[key] = checkFeedItemView(item);
    } else if (Value.Check(PRE_CARD_ITEM_SCHEMA, item)) {
      const source = context.deps.state.feedSources.get(item.sourceId);
      body[key] = checkFeedItemView({ ...item, kind: feedItemKind(item, source), author: null, image: null });
    } else if (Value.Check(FeedSourceViewSchema, item)) {
      body[key] = checkSourceLinks(item);
    } else if (Value.Check(PRE_SEARCH_SOURCE_SCHEMA, item)) {
      const stored = context.deps.state.feedSources.get(item.id);
      const terms = stored === undefined ? [item.query ?? item.label]
        : sourceSearchTerms({ ...stored, label: item.label, query: item.query });
      body[key] = checkSourceLinks({ ...item, searchTerms: item.kind === 'interest' ? terms : [] });
    }
  }
  return { ...reply, body };
}

export function getFeedItem(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const body: FeedItemResponse = { item: itemView(context.deps, state.feedItems.require(param(context, 'id')), true) };
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
  const range = query.day === undefined ? undefined : dayRange(query.day, timeZone);
  const filter = {
    ...(range === undefined ? {} : { arrivedFrom: range.start.toISOString(), arrivedBefore: range.end.toISOString() }),
    ...(query.origin === undefined ? {} : { origin: query.origin }),
    ...(query.includeHidden === undefined ? {} : { includeHidden: query.includeHidden }),
    ...(query.saved === undefined ? {} : { saved: query.saved }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
    ...(query.place === undefined ? {} : { place: query.place }),
  };
  const page = state.feedItems.listPage(filter, { limit: limit + 1, offset });
  const body: FeedListResponse = {
    items: page.slice(0, limit).map((item) => itemView(context.deps, item)),
    nextOffset: page.length > limit ? offset + limit : null,
    newToday: daily.feed.newToday(timeZone),
  };
  return { status: 200, body };
}

export function feedNav(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(FeedNavQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const timeZone = query.tz ?? DEFAULT_TIME_ZONE;
  const body: FeedNavResponse = navOf(context.deps, timeZone);
  return { status: 200, body };
}

/** GET /v2/feed/sources */
export function listFeedSources(context: RequestContext): Reply {
  requireAuth(context);
  const { state, daily } = context.deps;
  daily.subscriptions.builtIn('x');
  daily.subscriptions.builtIn('news');
  daily.subscriptions.builtIn('xhs');
  const sources = state.feedSources.all();
  const statuses = state.feedSourceStatus.all();
  const view = (source: FeedSource) => feedSourceView(source, statuses.get(source.id));
  const body: FeedSourcesResponse = {
    interests: sources.filter((source) => source.kind === 'interest').map(view),
    blocked: sources.filter((source) => source.kind === 'blocked_site').map(view),
    others: sources.filter((source) => (source.kind === 'internal' || source.kind === 'rss' || source.kind === 'x'
      || source.kind === 'reddit' || source.kind === 'xhs')
      && (source.ref === null || !RETIRED_SOURCE_REFS.includes(source.ref))).map(view),
    everyMinutes: FEED_SOURCE_EVERY_MS / 60_000,
    recentSites: state.feedItems.recentSites(RECENT_SITES_MAX),
  };
  return { status: 200, body };
}

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
  let found: { url: string; title: string | null };
  try {
    found = await external.discover(body.url, AbortSignal.timeout(DISCOVER_TIMEOUT_MS));
  } catch (error) {
    return addViaComputer(context, body, options, error);
  }
  const label = body.label?.trim() || found.title || siteOf(found.url);
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const source = context.deps.state.feedSources.ensure({ kind: 'rss', label: label.slice(0, 200),
      query: found.url, level: 'normal', ref: `rss:${createHash('sha256').update(found.url).digest('hex')}` });
    afterCommit(() => { context.deps.daily.subscriptions.scan(); });
    return { status: 201, body: { source: feedSourceView(source) } };
  }, options));
}

function addViaComputer(context: RequestContext, body: { requestId: string; url: string; label?: string | undefined },
  options: { bodyDigest: string }, error: unknown): Reply {
  const { daily, state } = context.deps;
  const handed = handOffText('rss', error);
  if (handed === null || !(error instanceof DailyError)) { throw error; }
  if (!daily.computerFetches.online()) {
    throw new DailyError('unreachable', `${error.message.replace(/，?过一会儿再试。?$/, '。')}`
      + '开着电脑上的 Plasticine 再加一次，会改由电脑去取。');
  }
  const url = checkUrl(checkPublicHttpsUrl(body.url).href);
  const label = body.label?.trim() || siteOf(url);
  return cleanFeedReply(context, idempotent(context, body.requestId, (afterCommit) => {
    const source = state.feedSources.ensure({ kind: 'rss', label: label.slice(0, 200), query: url, level: 'normal',
      ref: `rss:${createHash('sha256').update(url).digest('hex')}` });
    afterCommit(() => {
      daily.computerFetches.ask(url, { sourceId: source.id, discover: true });
      state.feedSourceStatus.failed(source.id, context.deps.now().toISOString(), handed);
    });
    return { status: 201, body: { source: feedSourceView(source) } };
  }, options));
}

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
