// 核密码、记输错（2026-11-08 密码登录）：登录、改密码、建账号链接都经这里，限流和文案一处管。输错不说是哪个错。

import { ApiError } from './api-error.ts';
import type { AppDeps, RequestContext } from './context.ts';
import { requestSource } from './local-access.ts';
import { verifyPassword } from './password-hash.ts';

function tooManyAttempts(retryAfterMs: number): ApiError {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return new ApiError(429, 'too_many_attempts', '输错的次数太多，先停一会儿。', { next: `${minutes} 分钟后再试。` });
}

/** 这个来源（或者全部来源加起来）输错太多了就先挡住，对的也不收。 */
export function checkNotLimited(context: RequestContext): string {
  const source = requestSource(context.req);
  if (context.deps.passwordLimiter.blocked(source)) {
    throw tooManyAttempts(context.deps.passwordLimiter.retryAfterMs(source));
  }
  return source;
}

export function recordFailure(context: RequestContext, source: string): void {
  context.deps.passwordLimiter.recordFailure(source);
}

/** 密码对不对（还没设过密码算不对）。 */
export async function passwordMatches(deps: Pick<AppDeps, 'state'>, password: string): Promise<boolean> {
  const stored = deps.state.ownerAccount.credentials();
  return stored !== null && await verifyPassword(password, stored);
}
