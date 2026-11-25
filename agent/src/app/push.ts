import {
  NotifyKindsSchema,
  PresenceRequestSchema,
  SubscribePushRequestSchema,
  UnsubscribePushRequestSchema,
  type PushKeyResponse,
  type SubscribePushResponse,
  type UnsubscribePushResponse,
} from '../../shared/api/index.ts';
import { readNotifyKinds, writeNotifyKinds } from '../attention/index.ts';
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

export async function testPush(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  return { status: 200, body: await context.deps.push.test(auth.device.id) };
}

export async function reportPresence(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(PresenceRequestSchema, await readJsonBody(context.req), '在看哪段对话');
  context.deps.presence.report(auth.device.id, body.conversation, context.deps.now());
  return { status: 200, body: { ok: true } };
}

export function notifyKinds(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: readNotifyKinds(context.deps.state) };
}

export async function saveNotifyKinds(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(NotifyKindsSchema, await readJsonBody(context.req), '通知开关');
  const kinds = writeNotifyKinds(context.deps.state, body);
  context.deps.hub.publish({ type: 'notify_kinds_changed', kinds });
  return { status: 200, body: kinds };
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
