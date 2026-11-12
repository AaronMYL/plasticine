// 群聊与替人答的线（2026-11-05 他定，迁移 0064）的本机状态。
// - net_groups：一个群一行，id 是建群的人生成、大家共用的群 id；avatar 是换过的群头像（没换由界面拿前 9 个成员拼）。
// - net_group_members：成员（含自己），position 是进群的先后（拼头像取前 9 个）。
// - group_messages：群里的一句（人话、问某人的 AI、AI 的回答、任务卡的位置、本机说明）；message_id 群内共用。
// - group_tasks：群里的任务卡：指给某人，或全群谁先接谁做；发起人那台定谁先接到。
// - net_responses：替人答的线和它在答的问题。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { MESSAGE_AUTHORS, NETWORK_TASK_DOERS } from './api/contacts.ts';
import { MATERIAL_KINDS, TIERS } from './api/visibility.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

// ---------- 群 ----------

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
  /** 自己退出的时间：退了不再收发，聊天留着。 */
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

// ---------- 群里的一句 ----------

export const GROUP_MESSAGE_KINDS = ['text', 'ask_ai', 'ai_text', 'task', 'system'] as const;
export type GroupMessageKind = (typeof GROUP_MESSAGE_KINDS)[number];

export const GroupMessageInputSchema = Type.Object({
  groupId: IdSchema,
  messageId: Text,
  authorAccountId: Text,
  author: Type.Enum(MESSAGE_AUTHORS),
  kind: Type.Enum(GROUP_MESSAGE_KINDS),
  text: Type.String(),
  /** 问谁的 AI（ask_ai）、哪个 AI 在答（ai_text）。 */
  targetAccountId: Type.Optional(Nullable(Text)),
  exchangeId: Type.Optional(Nullable(Text)),
  taskId: Type.Optional(Nullable(Text)),
  sentAt: IsoTimeSchema,
  requestId: Type.Optional(Nullable(Text)),
  readAt: Type.Optional(Nullable(IsoTimeSchema)),
  /** 第 12 批：回的是群里哪一句（那一句的 messageId）。 */
  replyTo: Type.Optional(Nullable(Text)),
}, STRICT);
export type GroupMessageInput = Static<typeof GroupMessageInputSchema>;
export const GroupMessagePatchSchema = Type.Partial(Type.Object({ readAt: Nullable(IsoTimeSchema) }), STRICT);
export const GroupMessageSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(GroupMessageInputSchema).properties,
});
export type GroupMessage = Static<typeof GroupMessageSchema>;

// ---------- 群里的任务卡 ----------

/** open = 还没人接；claimed 以后跟着发起人和接的人之间那条一对一任务走。 */
export const GROUP_TASK_STATES = ['open', 'claimed', 'in_progress', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;
export type GroupTaskState = (typeof GROUP_TASK_STATES)[number];

export const GroupTaskInputSchema = Type.Object({
  groupId: IdSchema,
  ownerAccountId: Text,
  /** 指给谁；null = 全群谁先接谁做。 */
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

// ---------- 替人答的线 ----------

/** answer = 别人问我的 Plasticine；self = 我在聊天里 @ 自己的 Plasticine（照对方能听到的档位答）。 */
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
