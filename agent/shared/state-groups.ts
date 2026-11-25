import { Type, type Static } from 'typebox';
import { MESSAGE_AUTHORS, NETWORK_TASK_DOERS } from './api/contacts.ts';
import { MATERIAL_KINDS, TIERS } from './api/visibility.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

export const GroupInputSchema = Type.Object({
  ownerAccountId: Text,
  name: Text,
  avatar: Type.Optional(Nullable(Type.String())),
  lastAt: IsoTimeSchema,
}, STRICT);
export type GroupInput = Static<typeof GroupInputSchema>;
export const GroupPatchSchema = Type.Partial(Type.Object({
  name: Text,
  avatar: Nullable(Type.String()),
  leftAt: Nullable(IsoTimeSchema),
  lastAt: IsoTimeSchema,
}), STRICT);
export type GroupPatch = Static<typeof GroupPatchSchema>;
export const GroupSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(GroupInputSchema).properties,
  leftAt: Nullable(IsoTimeSchema),
});
export type Group = Static<typeof GroupSchema>;

export interface GroupMember {
  groupId: string;
  accountId: string;
  handle: string;
  displayName: string;
  position: number;
  joinedAt: string;
  leftAt: string | null;
}

export const GROUP_MESSAGE_KINDS = ['text', 'ask_ai', 'ai_text', 'task', 'system'] as const;

export const GroupMessageInputSchema = Type.Object({
  groupId: IdSchema,
  messageId: Text,
  authorAccountId: Text,
  author: Type.Enum(MESSAGE_AUTHORS),
  kind: Type.Enum(GROUP_MESSAGE_KINDS),
  text: Type.String(),
  targetAccountId: Type.Optional(Nullable(Text)),
  exchangeId: Type.Optional(Nullable(Text)),
  taskId: Type.Optional(Nullable(Text)),
  sentAt: IsoTimeSchema,
  requestId: Type.Optional(Nullable(Text)),
  readAt: Type.Optional(Nullable(IsoTimeSchema)),
  replyTo: Type.Optional(Nullable(Text)),
}, STRICT);
export type GroupMessageInput = Static<typeof GroupMessageInputSchema>;
export const GroupMessagePatchSchema = Type.Partial(Type.Object({ readAt: Nullable(IsoTimeSchema) }), STRICT);
export const GroupMessageSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(GroupMessageInputSchema).properties,
});
export type GroupMessage = Static<typeof GroupMessageSchema>;

export const GROUP_TASK_STATES = ['open', 'claimed', 'in_progress', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;
export type GroupTaskState = (typeof GROUP_TASK_STATES)[number];

export const GroupTaskInputSchema = Type.Object({
  groupId: IdSchema,
  ownerAccountId: Text,
  assigneeAccountId: Nullable(Text),
  title: Text,
  goal: Text,
  deadline: Type.Optional(Nullable(IsoTimeSchema)),
  attachment: Type.Optional(Nullable(Type.String())),
  state: Type.Enum(GROUP_TASK_STATES),
  offeredAt: IsoTimeSchema,
  requestId: Type.Optional(Nullable(Text)),
}, STRICT);
export type GroupTaskInput = Static<typeof GroupTaskInputSchema>;
export const GroupTaskPatchSchema = Type.Partial(Type.Object({
  state: Type.Enum(GROUP_TASK_STATES),
  claimerAccountId: Nullable(Text),
  doer: Nullable(Type.Enum(NETWORK_TASK_DOERS)),
  claimedAt: Nullable(IsoTimeSchema),
}), STRICT);
export type GroupTaskPatch = Static<typeof GroupTaskPatchSchema>;
export const GroupTaskSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(GroupTaskInputSchema).properties,
  ...Type.Required(GroupTaskPatchSchema).properties,
});
export type GroupTask = Static<typeof GroupTaskSchema>;

export const RESPONSE_MODES = ['answer', 'self'] as const;
export const RESPONSE_ORIGINS = ['contact', 'group'] as const;

export const ResponseMaterialSchema = Type.Object({
  ref: Text,
  kind: Type.Enum(MATERIAL_KINDS),
  id: IdSchema,
  tier: Type.Enum(TIERS),
}, STRICT);
export type ResponseMaterial = Static<typeof ResponseMaterialSchema>;

export const NetResponseInputSchema = Type.Object({
  lineId: IdSchema,
  origin: Type.Enum(RESPONSE_ORIGINS),
  mode: Type.Enum(RESPONSE_MODES),
  contactId: Nullable(IdSchema),
  groupId: Nullable(IdSchema),
  questionId: IdSchema,
  exchangeId: Text,
  askerIsAi: Type.Boolean(),
  materials: Type.Array(ResponseMaterialSchema),
  status: Type.Union([Type.Literal('running'), Type.Literal('settled')]),
}, STRICT);
export type NetResponseInput = Static<typeof NetResponseInputSchema>;
export const NetResponsePatchSchema = Type.Partial(Type.Object({
  status: Type.Union([Type.Literal('running'), Type.Literal('settled')]),
  settledAt: Nullable(IsoTimeSchema),
}), STRICT);
export const NetResponseSchema = Type.Object({
  ...RECORD_META,
  ...NetResponseInputSchema.properties,
  settledAt: Nullable(IsoTimeSchema),
});
export type NetResponse = Static<typeof NetResponseSchema>;
