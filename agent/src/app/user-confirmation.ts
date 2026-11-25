import type { DeviceConfirmation } from '../../shared/state.ts';
import { unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';

export function userConfirmation(context: RequestContext): DeviceConfirmation {
  const auth = requireUserAuth(context);
  if (!stillAuthenticated(context.deps, auth)) {
    throw unauthorized('这台设备的登录在请求途中失效了，这次没有执行。');
  }
  return { deviceId: auth.device.id, confirmedAt: context.deps.now().toISOString() };
}

export async function confirmedWrite<B extends { requestId: string }>(
  context: RequestContext,
  check: (value: unknown) => B,
  work: (body: B, confirmation: DeviceConfirmation, afterCommit: AfterCommit) => Reply,
): Promise<Reply> {
  requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = check(raw.value);
  const confirmation = userConfirmation(context);
  return idempotent(context, body.requestId, (afterCommit) => work(body, confirmation, afterCommit), {
    bodyDigest: raw.digest,
  });
}
