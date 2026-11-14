// /v2/push: the VAPID public key, and subscribing / unsubscribing this device for 「立刻打断」 notifications
// (第 91 条 ⑤). Only the push service's host is shown back; the endpoint and the keys are not echoed or logged.
// 邮件兜底的开关接口（/v2/notifications/mail-fallback）《优化清单》第 12 条起删了：通知不再发邮件，表和历史数据留着。

import {
  PresenceRequestSchema,
  SubscribePushRequestSchema,
  UnsubscribePushRequestSchema,
  type PushKeyResponse,
  type SubscribePushResponse,
  type UnsubscribePushResponse,
} from '../../shared/api/index.ts';
import { withCurrent } from './conflict.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export function pushStatus(context: RequestContext): Reply {
  const auth = requireAuth(context);
  const subscribed = context.deps.state.pushSubscriptions.active().some((row) => row.deviceId === auth.device.id);
  return { status: 200, body: { subscribed } };
}

/** GET /v2/push/key */
export function pushKey(context: RequestContext): Reply {
  requireAuth(context);
  const body: PushKeyResponse = { publicKey: context.deps.push.publicKey };
  return { status: 200, body };
}

/** POST /v2/push/subscriptions */
export async function subscribePush(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(SubscribePushRequestSchema, await readJsonBody(context.req), '订阅');
  const { push } = context.deps;
  return idempotent(context, body.requestId, () => {
    const subscription = push.subscribe(auth.device.id, body.endpoint, body.keys);
    const response: SubscribePushResponse = {
      subscription: {
        id: subscription.id,
        endpointHost: new URL(subscription.endpoint).host,
        createdAt: subscription.createdAt,
        lastSentAt: subscription.lastSentAt,
      },
    };
    return { status: 201, body: response };
  });
}

/** POST /v2/push/test：给这台设备发一条测试通知（第13批），回发出几条、没发成的原因。 */
export async function testPush(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  return { status: 200, body: await context.deps.push.test(auth.device.id) };
}

/** POST /v2/presence：这台设备正开着哪段对话（null 是没在看）；新消息通知不打扰他正看着的那段（第13批）。 */
export async function reportPresence(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(PresenceRequestSchema, await readJsonBody(context.req), '在看哪段对话');
  context.deps.presence.report(auth.device.id, body.conversation, context.deps.now());
  return { status: 200, body: { ok: true } };
}

/** DELETE /v2/push/subscriptions */
export async function unsubscribePush(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(UnsubscribePushRequestSchema, await readJsonBody(context.req), '退订');
  const { push } = context.deps;
  return idempotent(context, body.requestId, () => {
    const response: UnsubscribePushResponse = { removed: push.unsubscribe(body.endpoint) };
    return { status: 200, body: response };
  });
}
