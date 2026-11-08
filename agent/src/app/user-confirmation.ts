// 本人已配对会话就是确认来源，不再要求浏览器额外保存签名钥匙。来源由服务端判定，客户端不能指定设备或确认时间。
// 系统浏览器仍使用自己的身份；确认请求继续绑定原始正文和 requestId，重发不重复执行。
import type { DeviceConfirmation } from '../../shared/state.ts';
import { unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';

/** 在读取请求体后调用，先确认会话仍有效，再取这次真实请求的设备和服务端时间。 */
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
