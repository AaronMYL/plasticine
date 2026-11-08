// 约定 1（《实施方案》第 5 节）：a side-effect request carries the client's request_id (a task command its action_id);
// within 24 hours a resend gets the stored status and body back and the work does not run again. The scope is
// method + path, so the same id sent to another route or another note is refused instead of answered with someone
// else's result.
// The work and its stored answer commit in one transaction, so an interruption between them cannot leave work done
// without the answer that stops a resend from doing it again; what must happen only after the commit (queueing a
// turn, pushing events) is handed to `afterCommit` (review-followups e4cef52). Before the work runs, the session is
// checked again: the body may have taken a while, and a device revoked meanwhile must not write (908a81e).

import { errorCategory, safeLog } from '../shared-log.ts';
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
      // The answer is stored: the work happened. A failed follow-up (an event, a queued turn) is logged; the
      // restart check (reconcile, interruptStaleRuns) finds what it left behind.
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
    // A failure of the service itself is not an answer to keep: the resend should try again.
    if (mapped.error.status >= 500) {
      throw error;
    }
    // The work rolled back with its transaction; the refusal is the answer a resend gets.
    const refusal = { status: mapped.error.status, body: mapped.error.body() };
    save(refusal);
    return refusal;
  }
}

/**
 * 要等外面（Cyber Hunter 中继）回话的写：先看 24 小时内同一个 request_id 有没有记下的回答；没有就做，做完连同回答
 * 记下。外面那一步本身也按 request_id 去重（中继按 requestId、本机按 request_id 唯一），所以两个同时到的重发不会做成两次。
 */
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
