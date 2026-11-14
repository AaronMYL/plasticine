// 信息流来源的管理（第 7 批第 10、13 条，他定）：都在信息流第二栏管——每行 ⋯ 里现在刷新 / 设置… / 暂停 / 删除，「+」加
// Reddit 版块（填版块名，服务器直接取）。暂停 / 继续沿用 POST /v2/feed/sources/:id/level（off / normal）。写操作按
// requestId 幂等；要先上网取东西的（加 Reddit 先取一次确认版块在、改订阅网址先找订阅地址）先取，再进幂等写。

import {
  AddRedditRequestSchema,
  DeleteFeedSourceRequestSchema,
  RedditPreviewQuerySchema,
  RefreshFeedSourceRequestSchema,
  UpdateFeedSourceRequestSchema,
  type FeedSourceResponse,
  type RedditPreviewResponse,
  type RefreshFeedSourceResponse,
} from '../../shared/api/index.ts';
import { redditFeedOf, redditFeedUrl, redditLabel, subredditOf } from '../../shared/reddit.ts';
import type { FeedSource, FeedSourcePatch } from '../../shared/state.ts';
import { DailyError } from '../daily/index.ts';
import { failureText } from '../shared-log.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { feedSourceView } from './daily-views.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

// 预览、确认版块在、找订阅地址都最多等这么久。
const FETCH_TIMEOUT_MS = 15_000;
const DELETABLE: ReadonlySet<FeedSource['kind']> = new Set(['rss', 'reddit']);

function subredditOrThrow(raw: string): string {
  const name = subredditOf(raw);
  if (name === null) {
    throw new ApiError(400, 'invalid_request', '版块名只能是字母、数字和下划线，比如 neuroscience。',
      { field: 'subreddit' });
  }
  return name;
}

function sourceWrite<T>(context: RequestContext, id: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (!(error instanceof StateError) || error.code !== 'version_conflict') {
      throw error;
    }
    const current = context.deps.state.feedSources.require(id);
    throw new ApiError(409, 'version_conflict', '这个来源在别处改过了，这次没有改。', {
      currentVersion: current.version,
      next: '看 current 里的最新版，确认后用最新的 version 再来。',
      extra: { current: feedSourceView(current) },
    });
  }
}

function subscriptions(context: RequestContext) {
  return context.deps.daily.subscriptions;
}

/** GET /v2/feed/sources/reddit/preview?subreddit=&sort= — 取不到不报错，回原因（对话框就地写出来）。 */
export async function previewReddit(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const query = checkInput(RedditPreviewQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const subreddit = subredditOf(query.subreddit);
  if (subreddit === null) {
    const body: RedditPreviewResponse = { subreddit: null, posts: [],
      error: '版块名只能是字母、数字和下划线' };
    return { status: 200, body };
  }
  try {
    const posts = await subscriptions(context).previewReddit(redditFeedUrl(subreddit, query.sort),
      AbortSignal.timeout(FETCH_TIMEOUT_MS));
    const body: RedditPreviewResponse = { subreddit, error: posts.length === 0 ? '这个版块最近没有帖子' : null,
      posts: posts.map((post) => ({ title: post.title, url: post.url, author: post.author,
        publishedAt: post.publishedAt })) };
    return { status: 200, body };
  } catch (error) {
    if (!(error instanceof DailyError)) {
      throw error;
    }
    const body: RedditPreviewResponse = { subreddit, posts: [], error: error.message };
    return { status: 200, body };
  }
}

/** POST /v2/feed/sources/reddit：加一个版块，加上就取一次。同一个版块（不管排序）只有一行。 */
export async function addReddit(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(AddRedditRequestSchema, raw.value, '加 Reddit 版块');
  const subreddit = subredditOrThrow(body.subreddit);
  const url = redditFeedUrl(subreddit, body.sort);
  const { state } = context.deps;
  return idempotent(context, body.requestId, (afterCommit) => {
    const ref = `reddit:${subreddit.toLowerCase()}`;
    let source = state.feedSources.ensure({ kind: 'reddit', label: redditLabel(subreddit), query: url,
      level: 'normal', ref });
    if (source.query !== url) {
      source = state.feedSources.update(source.id, source.version, { query: url });
    }
    // 第13批：预览时取到的直接存进来，加完马上有内容（不再等下一轮、也不怕下一轮被限流）。
    afterCommit(() => {
      if (subscriptions(context).ingestPreview(source.id) === 0) subscriptions(context).scan();
    });
    const reply: FeedSourceResponse = { source: feedSourceView(source) };
    return { status: 201, body: reply };
  }, { bodyDigest: raw.digest });
}

/** POST /v2/feed/sources/:id/settings：订阅改名字、网址、档位；Reddit 改排序。 */
export async function updateFeedSource(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(UpdateFeedSourceRequestSchema, raw.value, '改来源');
  const id = param(context, 'id');
  const { state } = context.deps;
  const current = state.feedSources.require(id);
  const patch: FeedSourcePatch = {
    ...(body.label === undefined ? {} : { label: body.label.trim() }),
    ...(body.level === undefined ? {} : { level: body.level }),
  };
  if (body.url !== undefined) {
    if (current.kind !== 'rss') {
      throw new ApiError(400, 'invalid_request', '只有订阅能改网址。', { field: 'url' });
    }
    const target = body.url.trim();
    if (target !== current.query) {
      const external = context.deps.daily.externalFeed;
      if (external === null) {
        throw new ApiError(503, 'not_configured', '订阅抓取还没接上，请稍后再试。');
      }
      patch.query = (await external.discover(target, AbortSignal.timeout(FETCH_TIMEOUT_MS))).url;
    }
  }
  if (body.sort !== undefined) {
    const reddit = current.kind === 'reddit' && current.query !== null ? redditFeedOf(current.query) : null;
    if (reddit === null) {
      throw new ApiError(400, 'invalid_request', '只有 Reddit 版块能改排序。', { field: 'sort' });
    }
    patch.query = redditFeedUrl(reddit.subreddit, body.sort);
  }
  return idempotent(context, body.requestId, (afterCommit) => {
    const source = sourceWrite(context, id, () => state.feedSources.update(id, body.version, patch));
    if (patch.query !== undefined) {
      // 换了地址：上次的结果不算数，马上按新地址取一次。
      state.feedSourceStatus.expire(id);
      afterCommit(() => { subscriptions(context).scan(); });
    }
    const reply: FeedSourceResponse = { source: feedSourceView(source, state.feedSourceStatus.read(id)) };
    return { status: 200, body: reply };
  }, { bodyDigest: raw.digest });
}

/**
 * POST /v2/feed/sources/:id/refresh：现在刷新。订阅、Reddit 马上取一次，等取完回结果（取不到的原因记在来源状态上，
 * 回的 source.status 里有）；X 记成到点，电脑客户端下次来问就去读。重复点只是再取一次，不会多出条目。
 */
export async function refreshFeedSource(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  checkInput(RefreshFeedSourceRequestSchema, raw.value, '刷新来源');
  const id = param(context, 'id');
  const { state } = context.deps;
  let added: number;
  try {
    added = await subscriptions(context).refreshNow(id);
  } catch (error) {
    if (error instanceof DailyError) {
      throw new ApiError(400, 'invalid_request', failureText(error));
    }
    throw error;
  }
  const body: RefreshFeedSourceResponse = {
    source: feedSourceView(state.feedSources.require(id), state.feedSourceStatus.read(id)),
    added,
  };
  return { status: 200, body };
}

/** POST /v2/feed/sources/:id/delete：删一个订阅 / Reddit 版块（内置的不删）。 */
export async function deleteFeedSource(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(DeleteFeedSourceRequestSchema, raw.value, '删来源');
  const id = param(context, 'id');
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    const current = state.feedSources.require(id);
    if (!DELETABLE.has(current.kind)) {
      throw new ApiError(400, 'invalid_request', '内置的来源不能删，可以暂停。');
    }
    const source = sourceWrite(context, id, () => state.feedSources.remove(id, body.version));
    const reply: FeedSourceResponse = { source: feedSourceView(source) };
    return { status: 200, body: reply };
  }, { bodyDigest: raw.digest });
}
