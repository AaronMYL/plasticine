import { ApiError } from './api-error.ts';
import type { AppDeps, RequestContext } from './context.ts';
import { requestSource } from './local-access.ts';
import { verifyPassword } from './password-hash.ts';

function tooManyAttempts(retryAfterMs: number): ApiError {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return new ApiError(429, 'too_many_attempts', '输错的次数太多，先停一会儿。', { next: `${minutes} 分钟后再试。` });
}

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

export async function passwordMatches(deps: Pick<AppDeps, 'state'>, password: string): Promise<boolean> {
  const stored = deps.state.ownerAccount.credentials();
  return stored !== null && await verifyPassword(password, stored);
}
