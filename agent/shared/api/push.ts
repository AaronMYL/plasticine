// /v2/push: Web Push for the 「立刻打断」 channel (第 91 条 ⑤：浏览器系统通知，第一次要在设备上允许). The browser
// subscribes with the server's VAPID public key and sends its PushSubscription here; the server keeps one row per
// endpoint and stops using it on unsubscribe (the row stays, with the time).
// What a push carries is only one sentence and a link (PushPayload): never the card's question or any private text.

import { Type, type Static } from 'typebox';
import { Nullable, PushEndpointSchema, PushKeysSchema } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

export const PUSH_PATH = `${API_PREFIX}/push`;
export const PUSH_BODY = '有一件事要你现在处理，点开看。';

// 主线通知（《优化清单》第 12 条）：系统通知的标题、点开去哪（Plasticine 栏目的主线，11-07 两层侧栏起的新地址），
// 后台线贴回主线时那一句。
// 服务端的网页推送和 Mac App 自己弹的通知用同一份。
export const NOTICE_TITLE = 'Plasticine';
export const MAIN_THREAD_PATH = '/#/plasticine';

/**
 * 贴回主线的后台线结果，系统通知里那一句：按 unmet / failed（LineMessageView.stopReason）。做成的（done）只在主线上贴
 * 结果、不弹（11-07 他定「只在没做成时弹」）；暂停的也不通知。
 */
export function reportBrief(stopReason: string | null): string | null {
  if (stopReason === 'unmet') return '后台的一件事没做成';
  if (stopReason === 'failed') return '后台的一件事没做完';
  return null;
}
/** 来信（第 8 批第 6 条）：系统通知里那一句，不带信的题目和正文（第 91 条）；点开到主线那张来信卡。 */
export const LETTER_BRIEF = 'Plasticine 给你写了一封信';
export const PUSH_KEY_PATH = `${PUSH_PATH}/key`;
export const PUSH_SUBSCRIPTIONS_PATH = `${PUSH_PATH}/subscriptions`;
export const PushStatusSchema = Type.Object({ subscribed: Type.Boolean() });
export type PushStatus = Static<typeof PushStatusSchema>;

/** GET /v2/push/key: the VAPID public key (base64url, uncompressed P-256) for PushManager.subscribe. */
export const PushKeyResponseSchema = Type.Object({ publicKey: Type.String({ pattern: '^[A-Za-z0-9_-]{80,100}$' }) });
export type PushKeyResponse = Static<typeof PushKeyResponseSchema>;

/** POST /v2/push/subscriptions: `PushSubscription.toJSON()` minus expirationTime, plus the request id. */
export const SubscribePushRequestSchema = Type.Object(
  { requestId: RequestIdSchema, endpoint: PushEndpointSchema, keys: PushKeysSchema },
  { additionalProperties: false },
);
export type SubscribePushRequest = Static<typeof SubscribePushRequestSchema>;

/** Only the push service's host is shown back; the endpoint itself is a capability and is not echoed. */
export const PushSubscriptionViewSchema = Type.Object({
  id: IdSchema,
  endpointHost: Type.String(),
  createdAt: IsoTimeSchema,
  lastSentAt: Nullable(IsoTimeSchema),
});
export type PushSubscriptionView = Static<typeof PushSubscriptionViewSchema>;

export const SubscribePushResponseSchema = Type.Object({ subscription: PushSubscriptionViewSchema });
export type SubscribePushResponse = Static<typeof SubscribePushResponseSchema>;

/** DELETE /v2/push/subscriptions → 200 { removed }: removed is false when the endpoint was not subscribed. */
export const UnsubscribePushRequestSchema = Type.Object(
  { requestId: RequestIdSchema, endpoint: PushEndpointSchema },
  { additionalProperties: false },
);
export type UnsubscribePushRequest = Static<typeof UnsubscribePushRequestSchema>;
export const UnsubscribePushResponseSchema = Type.Object({ removed: Type.Boolean() });
export type UnsubscribePushResponse = Static<typeof UnsubscribePushResponseSchema>;

/**
 * What the service worker receives (decrypted). `title` is the card's kind label (要你动手 …), `body` a fixed
 * sentence, `url` the page to open, `tag` lets a newer push for the same card replace the older notification.
 */
export const PushPayloadSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  url: Type.String({ pattern: '^/' }),
  tag: Type.String(),
});
export type PushPayload = Static<typeof PushPayloadSchema>;
