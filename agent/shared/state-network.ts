import { Type, type Static } from 'typebox';
import { CONTACT_MESSAGE_STATUSES, CONTACT_RELATIONS, CONTACT_STATES, MESSAGE_AUTHORS, NETWORK_TASK_DOERS,
  NETWORK_TASK_STATES, TASK_VERDICTS } from './api/contacts.ts';
import { MATERIAL_KINDS, TIERS } from './api/visibility.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

export const NETWORK_IDENTITY_ID = 'self';

export const NetworkIdentityInputSchema = Type.Object({
  accountId: Text,
  handle: Text,
  displayName: Text,
  relayUrl: Text,
  signingPublicKey: Text,
  signingPrivateKey: Text,
  encryptionPublicKey: Text,
  encryptionPrivateKey: Text,
  joinedAt: IsoTimeSchema,
  cursor: Type.Optional(Type.String()),
  lastSyncAt: Type.Optional(Nullable(IsoTimeSchema)),
  lastError: Type.Optional(Nullable(Type.String({ maxLength: 300 }))),
  avatar: Type.Optional(Nullable(Type.String())),
}, STRICT);
export type NetworkIdentityInput = Static<typeof NetworkIdentityInputSchema>;
export const NetworkIdentityPatchSchema = Type.Partial(Type.Object({
  displayName: Text,
  avatar: Nullable(Type.String()),
  cursor: Type.String(),
  lastSyncAt: Nullable(IsoTimeSchema),
  lastError: Nullable(Type.String({ maxLength: 300 })),
}), STRICT);
export type NetworkIdentityPatch = Static<typeof NetworkIdentityPatchSchema>;
export const NetworkIdentitySchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(NetworkIdentityInputSchema).properties,
});
export type NetworkIdentity = Static<typeof NetworkIdentitySchema>;

export const ContactInputSchema = Type.Object({
  accountId: Text,
  handle: Text,
  displayName: Text,
  signingKey: Text,
  encryptionKey: Text,
  relation: Type.Optional(Type.Enum(CONTACT_RELATIONS)),
  state: Type.Enum(CONTACT_STATES),
  tierCap: Type.Optional(Nullable(Type.Enum(TIERS))),
  lastAt: IsoTimeSchema,
  avatar: Type.Optional(Nullable(Type.String())),
}, STRICT);
export type ContactInput = Static<typeof ContactInputSchema>;
export const ContactPatchSchema = Type.Partial(Type.Object({
  handle: Text,
  displayName: Text,
  relation: Type.Enum(CONTACT_RELATIONS),
  state: Type.Enum(CONTACT_STATES),
  tierCap: Nullable(Type.Enum(TIERS)),
  signingKey: Text,
  encryptionKey: Text,
  safetyChanged: Type.Boolean(),
  pendingSigningKey: Nullable(Text),
  pendingEncryptionKey: Nullable(Text),
  ignoredAt: Nullable(IsoTimeSchema),
  lastAt: IsoTimeSchema,
  avatar: Nullable(Type.String()),
  alias: Nullable(Type.String({ minLength: 1, maxLength: 40 })),
  personDocId: Nullable(Type.String({ minLength: 1 })),
  linkDismissedAt: Nullable(IsoTimeSchema),
  removedAt: Nullable(IsoTimeSchema),
  aiName: Nullable(Type.String({ minLength: 1, maxLength: 40 })),
}), STRICT);
export type ContactPatch = Static<typeof ContactPatchSchema>;
export const ContactSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(ContactInputSchema).properties,
  safetyChanged: Type.Boolean(),
  pendingSigningKey: Nullable(Type.String()),
  pendingEncryptionKey: Nullable(Type.String()),
  ignoredAt: Nullable(IsoTimeSchema),
  alias: Nullable(Type.String()),
  personDocId: Nullable(Type.String()),
  linkDismissedAt: Nullable(IsoTimeSchema),
  removedAt: Nullable(IsoTimeSchema),
  aiName: Nullable(Type.String()),
});
export type Contact = Static<typeof ContactSchema>;

export const CONTACT_MESSAGE_KINDS = ['hello', 'text', 'ai_text', 'ask_ai', 'task_offer', 'task_reply',
  'task_delivery', 'task_verdict', 'read', 'system', 'profile', 'group_update', 'group_message', 'group_task',
  'task_claim', 'task_cancel', 'reaction'] as const;

export const ContactMessageInputSchema = Type.Object({
  contactId: IdSchema,
  direction: Type.Union([Type.Literal('in'), Type.Literal('out')]),
  author: Type.Enum(MESSAGE_AUTHORS),
  kind: Type.Enum(CONTACT_MESSAGE_KINDS),
  text: Type.String(),
  payload: Nullable(Type.Record(Type.String(), Type.Unknown())),
  exchangeId: Type.Optional(Nullable(Type.String())),
  taskId: Type.Optional(Nullable(Type.String())),
  sentAt: IsoTimeSchema,
  status: Type.Enum(CONTACT_MESSAGE_STATUSES),
  envelopeId: Type.Optional(Nullable(Type.String())),
  requestId: Type.Optional(Nullable(Type.String())),
  readAt: Type.Optional(Nullable(IsoTimeSchema)),
  groupId: Type.Optional(Nullable(IdSchema)),
}, STRICT);
export type ContactMessageInput = Static<typeof ContactMessageInputSchema>;
export const ContactMessagePatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(CONTACT_MESSAGE_STATUSES),
  attempts: Type.Integer({ minimum: 0 }),
  nextAttemptAt: Nullable(IsoTimeSchema),
  error: Nullable(Type.String({ maxLength: 300 })),
  readAt: Nullable(IsoTimeSchema),
}), STRICT);
export type ContactMessagePatch = Static<typeof ContactMessagePatchSchema>;
export const ContactMessageSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(ContactMessageInputSchema).properties,
  attempts: Type.Integer({ minimum: 0 }),
  nextAttemptAt: Nullable(IsoTimeSchema),
  error: Nullable(Type.String()),
});
export type ContactMessage = Static<typeof ContactMessageSchema>;

export const NetworkTaskInputSchema = Type.Object({
  direction: Type.Union([Type.Literal('out'), Type.Literal('in')]),
  contactId: IdSchema,
  title: Text,
  goal: Text,
  acceptance: Text,
  deadline: Type.Optional(Nullable(IsoTimeSchema)),
  attachment: Type.Optional(Nullable(Type.String())),
  state: Type.Enum(NETWORK_TASK_STATES),
  offeredAt: IsoTimeSchema,
  requestId: Type.Optional(Nullable(Type.String())),
  groupId: Type.Optional(Nullable(IdSchema)),
}, STRICT);
export type NetworkTaskInput = Static<typeof NetworkTaskInputSchema>;
export const NetworkTaskPatchSchema = Type.Partial(Type.Object({
  state: Type.Enum(NETWORK_TASK_STATES),
  doer: Nullable(Type.Enum(NETWORK_TASK_DOERS)),
  localTaskId: Nullable(IdSchema),
  askId: Nullable(IdSchema),
  decidedAt: Nullable(IsoTimeSchema),
  deliveryText: Nullable(Type.String()),
  deliveryAt: Nullable(IsoTimeSchema),
  verdict: Nullable(Type.Enum(TASK_VERDICTS)),
  verdictNote: Nullable(Type.String()),
  verdictAt: Nullable(IsoTimeSchema),
}), STRICT);
export type NetworkTaskPatch = Static<typeof NetworkTaskPatchSchema>;
export const NetworkTaskSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(NetworkTaskInputSchema).properties,
  ...Type.Required(NetworkTaskPatchSchema).properties,
});
export type NetworkTask = Static<typeof NetworkTaskSchema>;

export const VisibilityMarkSchema = Type.Object({
  ...RECORD_META,
  objectKind: Type.Enum(MATERIAL_KINDS),
  objectId: IdSchema,
  tier: Type.Enum(TIERS),
  proposed: Nullable(Type.Enum(TIERS)),
  confirmedAt: Nullable(IsoTimeSchema),
});
export type VisibilityMark = Static<typeof VisibilityMarkSchema>;

export const SaidMaterialSchema = Type.Object({
  kind: Type.Enum(MATERIAL_KINDS),
  id: IdSchema,
  tier: Type.Enum(TIERS),
}, STRICT);
export type SaidMaterial = Static<typeof SaidMaterialSchema>;
export const SaidLogInputSchema = Type.Object({
  contactId: IdSchema,
  text: Text,
  materials: Type.Array(SaidMaterialSchema),
  exchangeId: Nullable(Type.String()),
  messageId: Nullable(IdSchema),
}, STRICT);
export type SaidLogInput = Static<typeof SaidLogInputSchema>;
export const SaidLogSchema = Type.Object({ id: IdSchema, ...SaidLogInputSchema.properties, at: IsoTimeSchema });
export type SaidLog = Static<typeof SaidLogSchema>;
