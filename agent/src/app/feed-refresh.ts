import { RefreshFeedRequestSchema } from '../../shared/api/index.ts';
import { ApiError } from './api-error.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

/** POST /v2/feed/refresh → 202 持久化回执，完成结果用 GET 查询；断线不取消已接受的刷新。 */
export async function refreshFeed(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RefreshFeedRequestSchema, raw.value, '刷新信息流');
  const external = context.deps.daily.externalFeed;
  if (external === null) {
    throw new ApiError(503, 'not_configured', '信息流抓取还没接上，请稍后再试。');
  }
  return idempotent(context, body.requestId, (afterCommit) => {
    const run = external.queueRefresh(body.requestId);
    afterCommit(() => { external.resume(); });
    return { status: 202, body: run };
  }, { bodyDigest: raw.digest });
}

export function getFeedRefresh(context: RequestContext): Reply {
  requireAuth(context);
  const run = context.deps.state.feedFetchRuns.refresh(context.params['requestId'] ?? '');
  if (run === undefined) {
    throw new ApiError(404, 'not_found', '没有这次刷新记录，请核对请求标识。');
  }
  return { status: 200, body: run };
}
