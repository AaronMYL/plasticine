import type { RefreshFeedRequest, FeedRefresh, AddInterestRequest, InterestResponse, FeedComment,
  FeedCommentsResponse, AddFeedCommentRequest, RetryFeedCommentRequest, BlockFeedSiteRequest } from '../shared.ts';
// 假的信息流：条目（新的在前，不感兴趣的默认不在里面）、信息源（关注点、不要的、其他、最近来源）、手动加一条链接、
// 赞 / 不感兴趣 / 收藏、来源的多少。写操作按 requestId 幂等，带 version 的过时了回 409 和现在那一条；和真服务端
// （agent/src/app/feed.ts）一样，改来源的多少不推事件，条目变了推 feed.changed。

import type { FeedApi } from '../client.ts';
import { compareFeedItems } from '../../../../agent/shared/feed-order.ts';
import { searchTerms } from '../../../../agent/shared/feed-search.ts';
import type { AddSubscriptionRequest, TranscriberInstallRequest, TranscriberResponse } from '../shared.ts';
import {
  type AddRedditRequest,
  type DeleteFeedSourceRequest,
  type RedditPreviewQuery,
  type RedditPreviewResponse,
  type RefreshFeedSourceRequest,
  type RefreshFeedSourceResponse,
  type UpdateFeedSourceRequest,
  type DouyinListQuery,
  type DouyinListResponse,
  type DouyinProcessRequest,
  type DouyinProcessResponse,
  type DouyinSyncRequest,
  type DouyinSyncResponse,
  type FeedNavResponse,
} from '../shared.ts';
import { FakeDouyin, type FakeDouyinDeps } from './fake-douyin.ts';
import { FakeFeedSources } from './fake-feed-sources.ts';
import { ApiError, ConflictError } from '../errors.ts';
import { COGNITION_PAGE_DEFAULT, FEED_LIST_ORIGINS, FEED_ORIGIN_LABELS } from '../shared.ts';
import type {
  AddFeedItemRequest,
  FeedItemView,
  FeedListQuery,
  FeedListResponse,
  FeedSourcesResponse,
  FeedSourceView,
  ReactFeedItemRequest,
  SaveFeedItemRequest,
  SetSourceLevelRequest,
  SetSourceQueryRequest,
} from '../types.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

/** 和服务端一样：信息流只列站外收集的和手动添加的（任务、项目的旧条目不列，2026-11-04）。 */
function listed(item: FeedItemView): boolean {
  return (FEED_LIST_ORIGINS as readonly string[]).includes(item.origin);
}

/** 条目从哪一路来，按来源的种类推（和服务端 feedItemKind 一样）。 */
function itemKindOf(kind: FeedSourceView['kind'] | undefined): FeedItemView['kind'] {
  return kind === 'x' || kind === 'rss' || kind === 'douyin' || kind === 'reddit' || kind === 'xhs' ? kind : 'news';
}

/** 列表里不带全文（和服务端一样，读一条才给）。 */
function listed1(item: FeedItemView): FeedItemView {
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'body')) as FeedItemView;
}

export type FeedItemSeed = Pick<FeedItemView, 'id' | 'title'> & Partial<FeedItemView>;
export type FeedSourceSeed = Pick<FeedSourceView, 'id' | 'kind' | 'label'> & Partial<FeedSourceView>;

export interface FakeFeedDeps {
  publishWork?: NonNullable<FakeDouyinDeps['publishWork']>;
  installStepMs?: number;
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
}

/** 手动添加的条目都记在这个来源下面。 */
export const MANUAL_SOURCE_ID = 'src_manual';
export const X_SOURCE_ID = 'src_x';
export const NEWS_SOURCE_ID = 'src_news';
export const XHS_SOURCE_ID = 'src_xhs';
export const DOUYIN_SOURCE_ID = 'src_douyin';
/** 和服务端 FEED_SOURCE_EVERY_MS 一样：订阅和 X 每 2 小时。 */
const EVERY_MINUTES = 120;
const STALE_NEXT = '看 current 里的最新版，确认后用最新的 version 再来。';

/** 假实现里条目默认按本机时区记哪一天：和界面查询带的 tz（同样是本机时区）对得上。 */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 一个时刻在某个时区里是哪一天（YYYY-MM-DD）。 */
export function dayIn(instant: Date, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return format.format(instant);
}

function siteOf(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError({
        kind: 'invalid',
        code: 'invalid_request',
        message: '链接要是 http 或 https 开头的完整网址。',
        field: 'url',
        status: 400,
      });
    }
    throw error;
  }
}

export class FakeFeed implements FeedApi {
  all(): FeedItemView[] { return structuredClone([...this.items.values()]); }
  private readonly items = new Map<string, FeedItemView>();
  private readonly sourceRows = new Map<string, FeedSourceView>();
  /** 删掉的来源（第 7 批第 10 条）：行留着，不再列；它没收藏过的条目不再显示。 */
  private readonly removed = new Set<string>();
  private readonly sourceDesk: FakeFeedSources;
  private readonly deps: FakeFeedDeps;
  private sequence = 0;
  readonly commentRows = new Map<string, FeedComment[]>();
  readonly refreshRows = new Map<string, FeedRefresh>();

  /** 第 6 批第 9 条：抖音收藏的勾选清单。 */
  readonly douyinRows: FakeDouyin;

  constructor(deps: FakeFeedDeps) {
    this.deps = deps;
    this.douyinRows = new FakeDouyin(deps);
    this.sourceDesk = new FakeFeedSources(deps, { sources: this.sourceRows, items: this.items, removed: this.removed,
      freshToday: (item, timeZone) => this.shown(item) && item.reaction !== 'dislike'
        && dayIn(new Date(item.arrivedAt), timeZone) === dayIn(this.deps.now(), timeZone),
      seedSource: (seed) => this.seedSource(seed) });
    this.seedSource({ id: MANUAL_SOURCE_ID, kind: 'internal', label: '手动添加' });
    // 和服务端一样，内置来源（X、兴趣、小红书、抖音收藏）一直在。
    this.seedSource({ id: X_SOURCE_ID, kind: 'x', label: 'X', ref: 'x:following' });
    this.seedSource({ id: NEWS_SOURCE_ID, kind: 'internal', label: '兴趣', ref: 'internal:news' });
    this.seedSource({ id: XHS_SOURCE_ID, kind: 'xhs', label: '小红书', ref: 'xhs:feed' });
    this.seedSource({ id: DOUYIN_SOURCE_ID, kind: 'douyin', label: '抖音收藏', ref: 'douyin:favorites' });
  }

  async refresh(input: RefreshFeedRequest): Promise<FeedRefresh> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/feed/refresh', () => {
      const row: FeedRefresh = { requestId: input.requestId, day: dayIn(this.deps.now(), 'UTC'),
        status: 'completed', startedAt: this.deps.now().toISOString(), finishedAt: this.deps.now().toISOString(),
        added: 0, error: null };
      this.refreshRows.set(input.requestId, row);
      return row;
    });
  }
  async refreshStatus(requestId: string): Promise<FeedRefresh> {
    const row = this.refreshRows.get(requestId);
    if (row === undefined) { throw new Error('没有这次刷新记录。'); }
    return row;
  }
  async comments(id: string): Promise<FeedCommentsResponse> {
    this.deps.session.require();
    return { comments: this.commentRows.get(id) ?? [] };
  }
  async comment(id: string, input: AddFeedCommentRequest): Promise<FeedCommentsResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/items/${id}/comments`, () => {
      const row: FeedComment = { id: input.requestId, itemId: id, author: 'user', text: input.text,
        createdAt: this.deps.now().toISOString(), replyTo: null, status: 'completed', error: null,
        migrated: false, version: 1 };
      const reply: FeedComment = { ...row, id: `${row.id}:reply`, author: 'ai', replyTo: row.id,
        text: '可以留意它与你关切的联系。' };
      const comments = [...this.commentRows.get(id) ?? [], row, reply];
      this.commentRows.set(id, comments);
      return { comments };
    });
  }
  async retryComment(id: string, commentId: string, input: RetryFeedCommentRequest): Promise<FeedCommentsResponse> {
    const scope = `POST /v2/feed/items/${id}/comments/${commentId}/retry`;
    return this.deps.receipts.run('feed', input.requestId, scope, () => {
      const comments = (this.commentRows.get(id) ?? []).map((row) => row.id === commentId
        ? { ...row, status: 'completed' as const, error: null, text: '接着这条评论。', version: row.version + 1 } : row);
      this.commentRows.set(id, comments);
      return { comments };
    });
  }
  async addInterest(input: AddInterestRequest): Promise<InterestResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/feed/sources', () => {
      const source = this.seedSource({ id: `source:${input.requestId}`, kind: 'interest', label: input.label,
        query: input.query ?? input.label, concernId: null, level: 'more' });
      return { source };
    });
  }
  async blockSite(input: BlockFeedSiteRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/feed/sources/blocked', () => {
      const site = input.site.replace(/^www\./, '').toLowerCase();
      const existing = [...this.sourceRows.values()].find((row) => row.kind === 'blocked_site' && row.label === site);
      return this.seedSource({ id: existing?.id ?? `blocked:${site}`, kind: 'blocked_site', label: site,
        level: input.blocked ? 'off' : 'normal', version: (existing?.version ?? 0) + 1 });
    });
  }

  async get(id: string): Promise<FeedItemView> {
    this.deps.session.require();
    const item = this.items.get(id);
    if (item === undefined) {
      throw new ApiError({ kind: 'failed', code: 'not_found', status: 404,
        message: '这条信息已找不到。', next: '返回信息流查看其他内容。' });
    }
    return item;
  }

  async list(query: FeedListQuery): Promise<FeedListResponse> {
    this.deps.session.require();
    const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
    const offset = query.offset ?? 0;
    const timeZone = query.tz ?? localZone();
    const all = [...this.items.values()].filter((item) => this.shown(item))
      .filter((item) => query.includeHidden === true || item.reaction !== 'dislike')
      .filter((item) => query.saved !== true || item.saved)
      .filter((item) => query.origin === undefined || item.origin === query.origin)
      .filter((item) => query.kind === undefined || item.kind === query.kind)
      .filter((item) => query.sourceId === undefined || item.sourceId === query.sourceId)
      .filter((item) => query.place === undefined || (item.places ?? []).includes(query.place))
      .filter((item) => query.day === undefined || dayIn(new Date(item.arrivedAt), timeZone) === query.day)
      .sort(compareFeedItems);
    return {
      items: all.slice(offset, offset + limit).map(listed1),
      nextOffset: offset + limit < all.length ? offset + limit : null,
      newToday: this.newToday(timeZone),
    };
  }

  async nav(timeZone: string): Promise<FeedNavResponse> {
    this.deps.session.require();
    return this.sourceDesk.nav(timeZone);
  }

  async previewReddit(query: RedditPreviewQuery): Promise<RedditPreviewResponse> {
    this.deps.session.require();
    return this.sourceDesk.previewReddit(query);
  }

  async addReddit(input: AddRedditRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/feed/sources/reddit',
      () => this.sourceDesk.addReddit(input));
  }

  async updateSource(id: string, input: UpdateFeedSourceRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/sources/${id}/settings`,
      () => this.sourceDesk.update(id, input));
  }

  async refreshSource(id: string, input: RefreshFeedSourceRequest): Promise<RefreshFeedSourceResponse> {
    this.deps.session.require();
    return this.sourceDesk.refresh(id, input);
  }

  async deleteSource(id: string, input: DeleteFeedSourceRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/sources/${id}/delete`,
      () => this.sourceDesk.remove(id, input));
  }

  /** 列不列：站外收集的和手动添加的，删掉的来源只留收藏过的。 */
  private shown(item: FeedItemView): boolean {
    return listed(item) && (item.saved || !this.removed.has(item.sourceId));
  }

  douyin(query: DouyinListQuery): Promise<DouyinListResponse> {
    return this.douyinRows.list(query);
  }

  douyinSync(input: DouyinSyncRequest): Promise<DouyinSyncResponse> {
    return this.douyinRows.syncNow(input);
  }

  douyinProcess(input: DouyinProcessRequest): Promise<DouyinProcessResponse> {
    return this.douyinRows.process(input);
  }

  transcriber(): Promise<TranscriberResponse> {
    return this.douyinRows.transcriberStatus();
  }

  installTranscriber(input: TranscriberInstallRequest): Promise<TranscriberResponse> {
    return this.douyinRows.installTranscriber(input);
  }

  async sources(): Promise<FeedSourcesResponse> {
    this.deps.session.require();
    const all = [...this.sourceRows.values()].filter((source) => !this.removed.has(source.id));
    const sites = new Map<string, number>();
    for (const item of [...this.items.values()].filter(listed)) {
      if (item.site !== null) {
        sites.set(item.site, (sites.get(item.site) ?? 0) + 1);
      }
    }
    return {
      interests: all.filter((source) => source.kind === 'interest'),
      blocked: all.filter((source) => source.kind === 'blocked_site'),
      others: all.filter((source) => source.kind === 'internal' || source.kind === 'rss' || source.kind === 'x'
        || source.kind === 'reddit'),
      everyMinutes: EVERY_MINUTES,
      recentSites: [...sites.entries()].map(([site, count]) => ({ site, count })),
    };
  }

  async add(input: AddFeedItemRequest, timeZone: string): Promise<FeedItemView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, 'POST /v2/feed/items', () => {
      this.sequence += 1;
      const item = this.put({
        id: `feed_manual_${this.sequence}`,
        title: input.title,
        origin: 'manual',
        url: input.url ?? null,
        site: siteOf(input.url),
        summary: input.summary ?? '',
        why: input.why ?? '你手动加的。',
        concernId: input.concernId ?? null,
        sourceId: MANUAL_SOURCE_ID,
        day: dayIn(this.deps.now(), timeZone),
      });
      this.deps.bus.emit({ type: 'feed.changed', item });
      return item;
    });
  }

  async subscribe(input: AddSubscriptionRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/sources/subscriptions ${input.url}`, () => {
      const existing = [...this.sourceRows.values()].find((source) => source.query === input.url);
      return existing ?? this.seedSource({ id: `rss_${input.requestId}`, kind: 'rss',
        label: input.label ?? siteOf(input.url) ?? input.url, query: input.url });
    });
  }

  async react(id: string, input: ReactFeedItemRequest): Promise<FeedItemView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/items/${id}/reaction`, () =>
      this.commit(this.writable(id, input.version), { reaction: input.reaction }),
    );
  }

  async save(id: string, input: SaveFeedItemRequest): Promise<FeedItemView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/items/${id}/save`, () => {
      return this.commit(this.writable(id, input.version), { saved: input.saved });
    });
  }

  async setSourceLevel(id: string, input: SetSourceLevelRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    return this.deps.receipts.run('feed', input.requestId, `POST /v2/feed/sources/${id}/level`, () => {
      const source = this.sourceRows.get(id);
      if (source === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这个来源。', status: 404 });
      }
      if (source.version !== input.version) {
        throw new ConflictError(source, '这个来源在别处改过了，这次没有改。', STALE_NEXT);
      }
      const next = { ...source, level: input.level, version: source.version + 1 };
      this.sourceRows.set(id, next);
      return next;
    });
  }

  async setSourceQuery(id: string, input: SetSourceQueryRequest): Promise<FeedSourceView> {
    this.deps.session.require();
    const scope = `POST /v2/feed/sources/${id}/query ${JSON.stringify(input)}`;
    return this.deps.receipts.run('feed', input.requestId, scope, () => {
      const source = this.sourceRows.get(id);
      if (source === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这个来源。', status: 404 });
      }
      if (source.kind !== 'interest' || input.query.trim() === '' || input.query.length > 500) {
        throw new ApiError({ kind: 'invalid', code: 'invalid_request',
          message: '请在关注点里填写最多 500 字的搜索词。', status: 400 });
      }
      if (source.version !== input.version) {
        throw new ConflictError(source, '这个来源在别处改过了，这次没有改。', STALE_NEXT);
      }
      const next = { ...source, query: input.query.trim(), searchTerms: [input.query.trim()],
        version: source.version + 1 };
      this.sourceRows.set(id, next);
      return next;
    });
  }

  seedItem(seed: FeedItemSeed, emit = false): FeedItemView {
    const item = this.put(seed);
    if (emit) {
      this.deps.bus.emit({ type: 'feed.changed', item });
    }
    return item;
  }

  seedSource(seed: FeedSourceSeed): FeedSourceView {
    const source: FeedSourceView = {
      query: null,
      searchTerms: seed.kind === 'interest'
        ? searchTerms({ label: seed.label, query: seed.query ?? null, custom: !seed.migrated }) : [],
      level: 'normal',
      concernId: null,
      migrated: false,
      version: 1,
      ...seed,
    };
    this.sourceRows.set(source.id, source);
    return source;
  }

  /** 今天（按用户时区）到的条目有几条：「信息流 n 条新的」。 */
  newToday(timeZone: string): number {
    const today = dayIn(this.deps.now(), timeZone);
    return [...this.items.values()].filter(listed)
      .filter((item) => dayIn(new Date(item.arrivedAt), timeZone) === today).length;
  }

  find(id: string): FeedItemView | undefined {
    return this.items.get(id);
  }

  private put(seed: FeedItemSeed): FeedItemView {
    const at = this.deps.now().toISOString();
    const origin = seed.origin ?? 'manual';
    const sourceId = seed.sourceId ?? MANUAL_SOURCE_ID;
    const sourceKind = this.sourceRows.get(sourceId)?.kind;
    const kind: FeedItemView['kind'] = origin === 'manual' ? 'manual'
      : itemKindOf(sourceKind);
    const item: FeedItemView = {
      origin,
      kind,
      author: null,
      image: null,
      originLabel: FEED_ORIGIN_LABELS[origin],
      url: null,
      site: null,
      summary: '',
      why: '',
      topic: null,
      concernId: null,
      sourceId,
      sourceLabel: this.sourceRows.get(sourceId)?.label ?? FEED_ORIGIN_LABELS[origin],
      ref: null,
      day: dayIn(new Date(seed.arrivedAt ?? at), localZone()),
      arrivedAt: at,
      publishedAt: null,
      reaction: null,
      saved: false,
      note: null,
      migrated: false,
      version: 1,
      ...seed,
    };
    this.items.set(item.id, item);
    return item;
  }

  private writable(id: string, version: number): FeedItemView {
    const item = this.items.get(id);
    if (item === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这一条。', status: 404 });
    }
    if (item.version !== version) {
      throw new ConflictError(item, '这一条在别处改过了，这次没有改。', STALE_NEXT);
    }
    return item;
  }

  private commit(item: FeedItemView, patch: Partial<Pick<FeedItemView, 'reaction' | 'saved'>>): FeedItemView {
    const next = { ...item, ...patch, version: item.version + 1 };
    this.items.set(next.id, next);
    this.deps.bus.emit({ type: 'feed.changed', item: next });
    return next;
  }
}
