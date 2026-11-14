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

// ---------- 新消息通知（第13批，11-14 Aaron 定） ----------
// 联系人的新消息、群组的新消息、主线回复、队友回复：写谁发的 + 消息开头，点开定位到那一句。网页推送用上面的
// PushPayload；桌面客户端（Mac、Windows）收不到网页推送，由界面收到 notify 事件后自己弹（窗口在前台、正开着这段就不弹）。

/** 哪段对话：line:<线 id>，或 contact:<联系人或群的 id>。 */
export const ConversationKeySchema = Type.String({ pattern: '^(line|contact):.+$', maxLength: 200 });

export const NotifyEventSchema = Type.Object({
  type: Type.Literal('notify'),
  title: Type.String(),
  body: Type.String(),
  url: Type.String({ pattern: '^/' }),
  tag: Type.String(),
  conversation: ConversationKeySchema,
});
export type NotifyEvent = Static<typeof NotifyEventSchema>;

/**
 * POST /v2/presence：页面在前台时报一次自己正开着哪段对话（切走、页面到后台报 null）；服务端据此不通知他正看着的那段。
 * 一分钟左右报一次，90 秒没报就当没在看。
 */
export const PRESENCE_PATH = `${API_PREFIX}/presence`;
export const PresenceRequestSchema = Type.Object({ conversation: Nullable(ConversationKeySchema) },
  { additionalProperties: false });
export type PresenceRequest = Static<typeof PresenceRequestSchema>;

/** POST /v2/push/test：给这台设备发一条测试通知；回这台设备的订阅最近一次的结果（失败写原因）。 */
export const PUSH_TEST_PATH = `${PUSH_PATH}/test`;
export const PushTestResponseSchema = Type.Object({
  sent: Type.Integer({ minimum: 0 }),
  error: Nullable(Type.String()),
});
export type PushTestResponse = Static<typeof PushTestResponseSchema>;
export const TEST_NOTICE_BODY = '测试通知：能看到这一条，通知就是通的。';

// ---------- 按类型开关（第13批，11-14 Aaron：「通知消息可以按类型在设置中开关」） ----------
// 七类，所有设备一起生效（存在服务器的设置里）；关掉的那一类只是不弹系统通知，对话和消息里照常有、红点照常亮。
// ask 等你的事（要你同意、回答的卡）、contact 联系人消息、group 群组消息、main 主线回复（旁聊也算）、mate 队友回复、
// letter 来信、notice 提醒和结果（定时任务和心跳的结果、后台没做成的活、服务器磁盘快满）。

/** GET 读、PUT 整份存（PUT 回存好的那份，并在事件流上发 notify_kinds_changed）。 */
export const NOTIFY_KINDS_PATH = `${PUSH_PATH}/kinds`;
export const NotifyKindsSchema = Type.Object({
  ask: Type.Boolean(),
  contact: Type.Boolean(),
  group: Type.Boolean(),
  main: Type.Boolean(),
  mate: Type.Boolean(),
  letter: Type.Boolean(),
  notice: Type.Boolean(),
}, { additionalProperties: false });
export type NotifyKinds = Static<typeof NotifyKindsSchema>;
export type NotifyKind = keyof NotifyKinds;
/** 没设过就是都开着。 */
export const NOTIFY_KINDS_DEFAULT: NotifyKinds = Object.freeze({ ask: true, contact: true, group: true, main: true,
  mate: true, letter: true, notice: true });
export const NotifyKindsChangedEventSchema = Type.Object({
  type: Type.Literal('notify_kinds_changed'),
  kinds: NotifyKindsSchema,
});
