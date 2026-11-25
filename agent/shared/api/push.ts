import { Type, type Static } from 'typebox';
import { Nullable, PushEndpointSchema, PushKeysSchema } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

export const PUSH_PATH = `${API_PREFIX}/push`;
export const PUSH_BODY = '有一件事要你现在处理，点开看。';

export const NOTICE_TITLE = 'Plasticine';
export const MAIN_THREAD_PATH = '/#/plasticine';

export function reportBrief(stopReason: string | null): string | null {
  if (stopReason === 'unmet') return '后台的一件事没做成';
  if (stopReason === 'failed') return '后台的一件事没做完';
  return null;
}
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

export const PushPayloadSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
  url: Type.String({ pattern: '^/' }),
  tag: Type.String(),
});
export type PushPayload = Static<typeof PushPayloadSchema>;

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

export const PRESENCE_PATH = `${API_PREFIX}/presence`;
export const PresenceRequestSchema = Type.Object({ conversation: Nullable(ConversationKeySchema) },
  { additionalProperties: false });

export const PUSH_TEST_PATH = `${PUSH_PATH}/test`;
export const PushTestResponseSchema = Type.Object({
  sent: Type.Integer({ minimum: 0 }),
  error: Nullable(Type.String()),
});
export type PushTestResponse = Static<typeof PushTestResponseSchema>;
export const TEST_NOTICE_BODY = '测试通知：能看到这一条，通知就是通的。';

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
export const NOTIFY_KINDS_DEFAULT: NotifyKinds = Object.freeze({ ask: true, contact: true, group: true, main: true,
  mate: true, letter: true, notice: true });
export const NotifyKindsChangedEventSchema = Type.Object({
  type: Type.Literal('notify_kinds_changed'),
  kinds: NotifyKindsSchema,
});
