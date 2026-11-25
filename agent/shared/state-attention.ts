import { Type, type Static } from 'typebox';
import { ASK_BASES, type AskBasis } from './act-or-ask.ts';

export type { AskBasis } from './act-or-ask.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';
import { CHANNELS } from './state-objects.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

export const ASK_KINDS = ['decide', 'confirm', 'approve', 'act'] as const;
export const AskKindSchema = Type.Enum(ASK_KINDS);
export type AskKind = Static<typeof AskKindSchema>;

export const ASK_PURPOSES = [
  'money_confirmation',
  'backup_restore',
  'device_action',
  'network_task',
  'network_reply',
  'line_approval',
  'line_question',
  'subscription_schedule',
  'loop_offer',
] as const;
export const AskPurposeSchema = Type.Enum(ASK_PURPOSES);
export type AskPurpose = Static<typeof AskPurposeSchema>;

export const AskBasisSchema = Type.Enum(ASK_BASES);

export const ASK_LINES = ['retired', 'hard_line', 'by_confidence'] as const;
export type AskLine = (typeof ASK_LINES)[number];

export const ASK_PURPOSE_LINES: Readonly<Record<AskPurpose, { line: AskLine; basis: AskBasis }>> = {
  money_confirmation: { line: 'by_confidence', basis: 'missing' },
  backup_restore: { line: 'hard_line', basis: 'hard_line' },
  device_action: { line: 'hard_line', basis: 'hard_line' },
  network_task: { line: 'hard_line', basis: 'hard_line' },
  network_reply: { line: 'by_confidence', basis: 'missing' },
  line_approval: { line: 'hard_line', basis: 'hard_line' },
  line_question: { line: 'by_confidence', basis: 'missing' },
  subscription_schedule: { line: 'by_confidence', basis: 'inferred' },
  loop_offer: { line: 'hard_line', basis: 'hard_line' },
};

export const ChannelSchema = Type.Enum(CHANNELS);
export type Channel = Static<typeof ChannelSchema>;

export const ASK_STATUSES = ['open', 'answered', 'withdrawn'] as const;
export const AskStatusSchema = Type.Enum(ASK_STATUSES);

export const ASK_QUESTION_MAX_CHARS = 120;
export const ASK_DETAIL_MAX_CHARS = 4_000;
export const ASK_OPTION_MAX = 6;
export const AskOptionIdSchema = Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' });

export const AskOptionSchema = Type.Object(
  {
    id: AskOptionIdSchema,
    label: Type.String({ minLength: 1, maxLength: 30 }),
    recommended: Type.Boolean(),
    description: Nullable(Type.String({ maxLength: 200 })),
  },
  STRICT,
);
export type AskOption = Static<typeof AskOptionSchema>;

export const AskAnswerPlaceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), lineId: IdSchema }, STRICT),
  Type.Object({ kind: Type.Literal('wait') }, STRICT),
  Type.Object({ kind: Type.Literal('chat'), contactId: Nullable(IdSchema), groupId: Nullable(IdSchema) }, STRICT),
]);
export type AskAnswerPlace = Static<typeof AskAnswerPlaceSchema>;

/** What the user chose: an option, free text, or both (text only when the card has no options). */
export const AskAnswerSchema = Type.Object(
  {
    optionId: Nullable(AskOptionIdSchema),
    label: Type.String(),
    text: Nullable(Type.String()),
    place: Type.Optional(AskAnswerPlaceSchema),
  },
  STRICT,
);
export type AskAnswer = Static<typeof AskAnswerSchema>;

export const AskInputSchema = Type.Object(
  {
    kind: AskKindSchema,
    purpose: AskPurposeSchema,
    channel: ChannelSchema,
    question: Type.String({ minLength: 1, maxLength: ASK_QUESTION_MAX_CHARS }),
    detail: Type.Optional(Nullable(Type.String({ maxLength: ASK_DETAIL_MAX_CHARS }))),
    options: Type.Array(AskOptionSchema, { maxItems: ASK_OPTION_MAX }),
    taskId: Type.Optional(Nullable(IdSchema)),
    runId: Type.Optional(Nullable(IdSchema)),
    actionId: Type.Optional(Nullable(IdSchema)),
    context: Type.Optional(Nullable(Type.Record(Type.String(), Type.Unknown()))),
    basis: Type.Optional(Nullable(AskBasisSchema)),
  },
  STRICT,
);
export type AskInput = Static<typeof AskInputSchema>;

export const AskPatchSchema = Type.Partial(
  Type.Object({
    status: AskStatusSchema,
    answer: Nullable(AskAnswerSchema),
    answeredAt: Nullable(IsoTimeSchema),
    answeredByDeviceId: Nullable(IdSchema),
    deferredAt: Nullable(IsoTimeSchema),
    withdrawnAt: Nullable(IsoTimeSchema),
    feedback: Nullable(Type.Enum(['appropriate', 'unnecessary'])),
    feedbackAt: Nullable(IsoTimeSchema),
    context: Nullable(Type.Record(Type.String(), Type.Unknown())),
  }),
  STRICT,
);

export const AskSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(AskInputSchema).properties,
  status: AskStatusSchema,
  answer: Nullable(AskAnswerSchema),
  answeredAt: Nullable(IsoTimeSchema),
  answeredByDeviceId: Nullable(IdSchema),
  deferredAt: Nullable(IsoTimeSchema),
  withdrawnAt: Nullable(IsoTimeSchema),
  feedback: Nullable(Type.Enum(['appropriate', 'unnecessary'])),
  feedbackAt: Nullable(IsoTimeSchema),
});
export type Ask = Static<typeof AskSchema>;

/** The keys a browser's PushSubscription carries (RFC 8291): the P-256 public key and the 16-byte auth secret. */
export const PushKeysSchema = Type.Object(
  {
    p256dh: Type.String({ pattern: '^[A-Za-z0-9_-]{80,100}$' }),
    auth: Type.String({ pattern: '^[A-Za-z0-9_-]{16,32}$' }),
  },
  STRICT,
);

export const PUSH_ENDPOINT_MAX_CHARS = 2_048;
export const PushEndpointSchema = Type.String({ pattern: '^https://', maxLength: PUSH_ENDPOINT_MAX_CHARS });

export const PushSubscriptionInputSchema = Type.Object(
  { deviceId: IdSchema, endpoint: PushEndpointSchema, ...PushKeysSchema.properties },
  STRICT,
);
export type PushSubscriptionInput = Static<typeof PushSubscriptionInputSchema>;
export const PushSubscriptionPatchSchema = Type.Partial(
  Type.Object({
    deviceId: IdSchema,
    p256dh: PushKeysSchema.properties.p256dh,
    auth: PushKeysSchema.properties.auth,
    revokedAt: Nullable(IsoTimeSchema),
    lastSentAt: Nullable(IsoTimeSchema),
    lastError: Nullable(Text),
    generation: Type.Integer({ minimum: 1 }),
  }),
  STRICT,
);
export type PushSubscriptionPatch = Static<typeof PushSubscriptionPatchSchema>;
export const PushSubscriptionSchema = Type.Object({
  ...RECORD_META,
  ...PushSubscriptionInputSchema.properties,
  revokedAt: Nullable(IsoTimeSchema),
  lastSentAt: Nullable(IsoTimeSchema),
  lastError: Nullable(Type.String()),
  generation: Type.Integer({ minimum: 1 }),
});
export type PushSubscription =Static<typeof PushSubscriptionSchema>;

