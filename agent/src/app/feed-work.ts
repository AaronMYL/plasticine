import { AddFeedCommentRequestSchema, RetryFeedCommentRequestSchema,
  BlockFeedSiteRequestSchema } from '../../shared/api/index.ts';
import { cleanSite } from '../daily/index.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { feedSourceView } from './daily-views.ts';
import { ApiError } from './api-error.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { checkInput } from './validate.ts';
import { idempotent } from './idempotency.ts';

function comments(context: RequestContext) {
  const service = context.deps.daily.comments;
  if (service === null) { throw new ApiError(503, 'not_configured', '评论回复暂未接上，请稍后再试。'); }
  return service;
}

export function listFeedComments(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: { comments: comments(context).list(param(context, 'id')) } };
}

export async function addFeedComment(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(AddFeedCommentRequestSchema, raw.value, '信息流评论');
  const id = param(context, 'id');
  const service = comments(context);
  context.deps.state.feedItems.require(id);
  return idempotent(context, body.requestId, (afterCommit) => {
    context.deps.state.feedComments.add(id, body.requestId, body.text.trim());
    afterCommit(() => service.resume());
    return { status: 201, body: { comments: service.list(id) } };
  }, { bodyDigest: raw.digest });
}

export async function retryFeedComment(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RetryFeedCommentRequestSchema, raw.value, '重试评论回复');
  const id = param(context, 'id');
  const replyId = param(context, 'commentId');
  const service = comments(context);
  const reply = context.deps.state.feedComments.get(replyId);
  if (reply === undefined || reply.itemId !== id || reply.author !== 'ai') {
    throw new ApiError(404, 'not_found', '没有这条未完成的回复，请重新读取评论。');
  }
  return idempotent(context, body.requestId, (afterCommit) => {
    context.deps.state.feedComments.retry(replyId);
    afterCommit(() => service.resume());
    return { status: 200, body: { comments: service.list(id) } };
  }, { bodyDigest: raw.digest });
}

export async function blockFeedSite(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(BlockFeedSiteRequestSchema, raw.value, '网站偏好');
  const site = cleanSite(body.site)?.replace(/^www\./, '').toLowerCase();
  if (site === undefined || site === '') { throw new ApiError(400, 'invalid_request', '网站名称无效，请重新读取来源。'); }
  const state = context.deps.state;
  return idempotent(context, body.requestId, () => {
    const existing = state.feedSources.all({ kind: 'blocked_site' })
      .find((source) => cleanSite(source.label)?.replace(/^www\./, '').toLowerCase() === site);
    const level = body.blocked ? 'off' : 'normal';
    const source = existing === undefined
      ? state.feedSources.create({ kind: 'blocked_site', label: site, level, ref: `blocked-site:${site}` })
      : existing.level === level ? existing : state.feedSources.update(existing.id, existing.version, { level });
    return { status: 200, body: { source: feedSourceView(source) } };
  }, { bodyDigest: raw.digest });
}
