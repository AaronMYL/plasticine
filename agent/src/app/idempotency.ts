import { errorCategory, safeLog } from '../util/index.ts';
import { IDEMPOTENCY_WINDOW_MS, REPLAYED_HEADER } from '../../shared/api/index.ts';
import { ApiError, toApiError, unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import type { Reply, RequestContext } from './context.ts';

export type AfterCommit = (action: () => void) => void;

function runAfterCommit(actions: readonly (() => void)[]): void {
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      safeLog('error', 'after_commit_failed', { category: errorCategory(error) });
    }
  }
}

export interface IdempotencyOptions {
  /**
   * SHA-256 of the request body. Stored with the answer; a resend whose body differs is refused
   * instead of answered, so one request id can never stand for two different confirmations.
   */
  bodyDigest?: string;
}

export function idempotent(
  context: RequestContext,
  requestId: string,
  work: (afterCommit: AfterCommit) => Reply,
  options: IdempotencyOptions = {},
): Reply {
  const { state } = context.deps;
  if (context.auth !== null && !stillAuthenticated(context.deps, context.auth)) {
    throw unauthorized('这台设备的登录在请求途中失效了，这次没有执行。');
  }
  const now = context.deps.now();
  const scope = `${context.req.method ?? 'GET'} ${context.url.pathname}`;
  const stored = state.apiRequests.find(requestId);
  if (stored !== undefined && Date.parse(stored.expiresAt) > now.getTime()) {
    if (stored.scope !== scope) {
      throw new ApiError(409, 'request_id_reused', '这个 request_id 已经用在另一个操作上了。', {
        field: 'requestId',
        next: '每个新操作生成一个新的 request_id；重发同一个操作才用原来的。',
      });
    }
    if (options.bodyDigest !== undefined && stored.bodyDigest !== options.bodyDigest) {
      throw new ApiError(409, 'request_id_reused', '这个 request_id 已经用过了，这次带的内容和上次不一样，没有执行。', {
        field: 'requestId',
        next: '改了内容就是新操作，换一个新的 request_id；重发原来的操作要带原样的内容。',
      });
    }
    return { status: stored.status, body: stored.body, headers: { [REPLAYED_HEADER]: '1' } };
  }
  const save = (reply: Reply): void => {
    state.apiRequests.save({
      requestId,
      scope,
      deviceId: context.auth?.device.id ?? null,
      status: reply.status,
      body: reply.body ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_WINDOW_MS).toISOString(),
      bodyDigest: options.bodyDigest ?? null,
    });
  };
  const pending: (() => void)[] = [];
  try {
    const reply = state.transaction(() => {
      const answer = work((action) => pending.push(action));
      save(answer);
      return answer;
    });
    runAfterCommit(pending);
    return reply;
  } catch (error) {
    const mapped = toApiError(error);
    if (mapped.error.status >= 500) {
      throw error;
    }
    const refusal = { status: mapped.error.status, body: mapped.error.body() };
    save(refusal);
    return refusal;
  }
}

export async function idempotentAsync(
  context: RequestContext,
  requestId: string,
  work: () => Promise<Reply>,
): Promise<Reply> {
  const { state } = context.deps;
  const scope = `${context.req.method ?? 'GET'} ${context.url.pathname}`;
  const stored = state.apiRequests.find(requestId);
  if (stored !== undefined && Date.parse(stored.expiresAt) > context.deps.now().getTime() && stored.scope === scope) {
    return { status: stored.status, body: stored.body, headers: { [REPLAYED_HEADER]: '1' } };
  }
  let reply: Reply;
  try {
    reply = await work();
  } catch (error) {
    return idempotent(context, requestId, () => {
      throw error;
    });
  }
  return idempotent(context, requestId, () => reply);
}
