import { FEED_REFRESH_PATH, FeedRefreshSchema, FeedCommentsResponseSchema, InterestResponseSchema,
  type RefreshFeedRequest, type FeedRefresh, type FeedCommentsResponse, type AddFeedCommentRequest,
  type RetryFeedCommentRequest, type AddInterestRequest, type InterestResponse,
  type BlockFeedSiteRequest } from '../shared.ts';
// /v2/feed 的真实现：条目（新的在前，不感兴趣的默认不在里面）、信息源、手动加一条链接、赞 / 不感兴趣 / 收藏、来源的
// 多少。带 version 的写操作过时了服务端回 409 和现在那一条，换成 ConflictError。

import type { FeedApi } from '../client.ts';
import { FEED_SUBSCRIPTIONS_PATH, type AddSubscriptionRequest } from '../shared.ts';
import {
  DOUYIN_PATH,
  DOUYIN_PROCESS_PATH,
  DOUYIN_SYNC_PATH,
  DouyinListResponseSchema,
  DouyinProcessResponseSchema,
  DouyinSyncResponseSchema,
  FEED_NAV_PATH,
  FeedNavResponseSchema,
  type DouyinListQuery,
  type DouyinListResponse,
  type DouyinProcessRequest,
  type DouyinProcessResponse,
  type DouyinSyncRequest,
  type DouyinSyncResponse,
  type FeedNavResponse,
} from '../shared.ts';
import {
  FEED_ITEMS_PATH,
  FEED_PATH,
  FEED_SOURCES_PATH,
  FeedItemResponseSchema,
  FeedItemViewSchema,
  FeedListResponseSchema,
  FeedSourceResponseSchema,
  FeedSourcesResponseSchema,
  FeedSourceViewSchema,
} from '../shared.ts';
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
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

function itemPath(id: string): string {
  return `${FEED_ITEMS_PATH}/${encodeURIComponent(id)}`;
}

export class HttpFeed implements FeedApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async get(id: string, signal?: AbortSignal): Promise<FeedItemView> {
    const result = await this.transport.request({ method: 'GET', path: itemPath(id),
      schema: FeedItemResponseSchema, what: '读这条信息', lostAs: 'failed', signal });
    return result.item;
  }

  refresh(body: RefreshFeedRequest): Promise<FeedRefresh> {
    return this.transport.request({ method: 'POST', path: FEED_REFRESH_PATH, body,
      schema: FeedRefreshSchema, what: '寻找新内容', lostAs: 'uncertain' });
  }
  refreshStatus(requestId: string, signal?: AbortSignal): Promise<FeedRefresh> {
    return this.transport.request({ method: 'GET', path: `${FEED_REFRESH_PATH}/${encodeURIComponent(requestId)}`,
      schema: FeedRefreshSchema, what: '读取刷新进度', lostAs: 'failed', signal });
  }
  comments(id: string, signal?: AbortSignal): Promise<FeedCommentsResponse> {
    return this.transport.request({ method: 'GET', path: `${itemPath(id)}/comments`,
      schema: FeedCommentsResponseSchema, what: '读评论', lostAs: 'failed', signal });
  }
  comment(id: string, body: AddFeedCommentRequest): Promise<FeedCommentsResponse> {
    return this.transport.request({ method: 'POST', path: `${itemPath(id)}/comments`, body,
      schema: FeedCommentsResponseSchema, what: '评论', lostAs: 'uncertain' });
  }
  retryComment(id: string, commentId: string, body: RetryFeedCommentRequest): Promise<FeedCommentsResponse> {
    return this.transport.request({ method: 'POST',
      path: `${itemPath(id)}/comments/${encodeURIComponent(commentId)}/retry`, body,
      schema: FeedCommentsResponseSchema, what: '重试评论回复', lostAs: 'uncertain' });
  }
  addInterest(body: AddInterestRequest): Promise<InterestResponse> {
    return this.transport.request({ method: 'POST', path: FEED_SOURCES_PATH, body,
      schema: InterestResponseSchema, what: '加关注点', lostAs: 'uncertain' });
  }
  async blockSite(body: BlockFeedSiteRequest): Promise<FeedSourceView> {
    const result = await this.transport.request({ method: 'POST', path: `${FEED_SOURCES_PATH}/blocked`, body,
      schema: FeedSourceResponseSchema, what: body.blocked ? '屏蔽网站' : '恢复网站', lostAs: 'uncertain' });
    return result.source;
  }

  async list(query: FeedListQuery, signal?: AbortSignal): Promise<FeedListResponse> {
    return this.transport.request({
      method: 'GET',
      path: FEED_PATH,
      query: {
        day: query.day,
        origin: query.origin,
        includeHidden: query.includeHidden,
        saved: query.saved,
        kind: query.kind,
        tz: query.tz,
        limit: query.limit,
        offset: query.offset,
      },
      schema: FeedListResponseSchema,
      what: '读信息流',
      lostAs: 'failed',
      signal,
    });
  }

  async subscribe(body: AddSubscriptionRequest): Promise<FeedSourceView> {
    const result = await this.transport.request({ method: 'POST', path: FEED_SUBSCRIPTIONS_PATH, body,
      schema: FeedSourceResponseSchema, what: '添加订阅', lostAs: 'uncertain' });
    return result.source;
  }

  nav(timeZone: string, signal?: AbortSignal): Promise<FeedNavResponse> {
    return this.transport.request({ method: 'GET', path: FEED_NAV_PATH, query: { tz: timeZone },
      schema: FeedNavResponseSchema, what: '读信息流的来源', lostAs: 'failed', signal });
  }

  douyin(query: DouyinListQuery, signal?: AbortSignal): Promise<DouyinListResponse> {
    return this.transport.request({ method: 'GET', path: DOUYIN_PATH,
      query: { folder: query.folder, q: query.q, limit: query.limit, offset: query.offset },
      schema: DouyinListResponseSchema, what: '读抖音收藏', lostAs: 'failed', signal });
  }

  douyinSync(body: DouyinSyncRequest): Promise<DouyinSyncResponse> {
    return this.transport.request({ method: 'POST', path: DOUYIN_SYNC_PATH, body,
      schema: DouyinSyncResponseSchema, what: '同步抖音收藏', lostAs: 'uncertain' });
  }

  douyinProcess(body: DouyinProcessRequest): Promise<DouyinProcessResponse> {
    return this.transport.request({ method: 'POST', path: DOUYIN_PROCESS_PATH, body,
      schema: DouyinProcessResponseSchema, what: '处理抖音收藏', lostAs: 'uncertain' });
  }

  async sources(signal?: AbortSignal): Promise<FeedSourcesResponse> {
    return this.transport.request({
      method: 'GET',
      path: FEED_SOURCES_PATH,
      schema: FeedSourcesResponseSchema,
      what: '读信息源',
      lostAs: 'failed',
      signal,
    });
  }

  async add(input: AddFeedItemRequest, timeZone: string): Promise<FeedItemView> {
    const response = await this.transport.request({
      method: 'POST',
      path: FEED_ITEMS_PATH,
      query: { tz: timeZone },
      body: input,
      schema: FeedItemResponseSchema,
      what: '加一条链接',
      lostAs: 'uncertain',
    });
    return response.item;
  }

  async react(id: string, input: ReactFeedItemRequest): Promise<FeedItemView> {
    return this.itemWrite(`${itemPath(id)}/reaction`, input, '反应');
  }

  async save(id: string, input: SaveFeedItemRequest): Promise<FeedItemView> {
    return this.itemWrite(`${itemPath(id)}/save`, input, '收藏');
  }

  async setSourceLevel(id: string, input: SetSourceLevelRequest): Promise<FeedSourceView> {
    const response = await this.transport.request({
      method: 'POST',
      path: `${FEED_SOURCES_PATH}/${encodeURIComponent(id)}/level`,
      body: input,
      schema: FeedSourceResponseSchema,
      what: '调来源多少',
      lostAs: 'uncertain',
      refine: conflictWith(FeedSourceViewSchema),
    });
    return response.source;
  }

  async setSourceQuery(id: string, input: SetSourceQueryRequest): Promise<FeedSourceView> {
    const response = await this.transport.request({ method: 'POST',
      path: `${FEED_SOURCES_PATH}/${encodeURIComponent(id)}/query`, body: input,
      schema: FeedSourceResponseSchema, what: '保存搜索词', lostAs: 'uncertain',
      refine: conflictWith(FeedSourceViewSchema) });
    return response.source;
  }

  private async itemWrite(path: string, body: unknown, what: string): Promise<FeedItemView> {
    const response = await this.transport.request({
      method: 'POST',
      path,
      body,
      schema: FeedItemResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(FeedItemViewSchema),
    });
    return response.item;
  }
}
