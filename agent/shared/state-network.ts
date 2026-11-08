// 联系人与 Cyber Hunter 网络的本机状态（第 113 条，docs/specs/contacts-network.md 第 5 节；迁移 0045）。
// - network_identity：这台实例在网络上的账号（一行），两对钥匙（私钥只在这里，不进日志、接口、测试快照）、收信游标；
// - contacts：网络上的人（公钥首次见到就记下，TOFU；变了不自动换，标 safety_changed 等用户核对）；
// - contact_messages：进出的每一封信（出去的那些也是发件箱：sending → sent / failed，按 envelope_id 重发不重复）；
// - network_tasks：跨用户任务；visibility_marks：材料的档位（没有记录 = 私密）；said_log：分身对外说过的话。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { CONTACT_MESSAGE_STATUSES, CONTACT_RELATIONS, CONTACT_STATES, MESSAGE_AUTHORS, NETWORK_TASK_DOERS,
  NETWORK_TASK_STATES, TASK_VERDICTS } from './api/contacts.ts';
import { MATERIAL_KINDS, TIERS } from './api/visibility.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

// ---------- 账号 ----------

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
  /** 头像（data URL，圆形裁好的小图）；没有是 null（0064）。 */
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

// ---------- 联系人 ----------

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
  /** 「先不理」这条请求：列表里不显示；对方再发 hello 才重新出现。 */
  ignoredAt: Nullable(IsoTimeSchema),
  lastAt: IsoTimeSchema,
  /** 对方经 hello / profile 发来的头像。 */
  avatar: Nullable(Type.String()),
}), STRICT);
export type ContactPatch = Static<typeof ContactPatchSchema>;
export const ContactSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(ContactInputSchema).properties,
  safetyChanged: Type.Boolean(),
  pendingSigningKey: Nullable(Type.String()),
  pendingEncryptionKey: Nullable(Type.String()),
  ignoredAt: Nullable(IsoTimeSchema),
});
export type Contact = Static<typeof ContactSchema>;

// ---------- 消息（也是发件箱） ----------

/** 信封的 kind，加上本机自己记的一条（验不过的信、自动停下的 AI↔AI 这类说明）。 */
export const CONTACT_MESSAGE_KINDS = ['hello', 'text', 'ai_text', 'ask_ai', 'task_offer', 'task_reply',
  'task_delivery', 'task_verdict', 'read', 'system', 'profile', 'group_update', 'group_message', 'group_task',
  'task_claim', 'task_cancel'] as const;
export type ContactMessageKind = (typeof CONTACT_MESSAGE_KINDS)[number];

export const ContactMessageInputSchema = Type.Object({
  contactId: IdSchema,
  direction: Type.Union([Type.Literal('in'), Type.Literal('out')]),
  author: Type.Enum(MESSAGE_AUTHORS),
  kind: Type.Enum(CONTACT_MESSAGE_KINDS),
  /** 给人看的那一句（任务类是标题或交付正文的开头）；read 是空的。 */
  text: Type.String(),
  /** 信封里的明文（进来的是解密后的，出去的是要加密的）；system 没有。 */
  payload: Nullable(Type.Record(Type.String(), Type.Unknown())),
  exchangeId: Type.Optional(Nullable(Type.String())),
  taskId: Type.Optional(Nullable(Type.String())),
  sentAt: IsoTimeSchema,
  status: Type.Enum(CONTACT_MESSAGE_STATUSES),
  envelopeId: Type.Optional(Nullable(Type.String())),
  requestId: Type.Optional(Nullable(Type.String())),
  readAt: Type.Optional(Nullable(IsoTimeSchema)),
  /** 群的发件箱那几行（给每个成员各一封）：不进一对一的聊天（0064）。 */
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

// ---------- 跨用户任务 ----------

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
  /** 群里的任务被接下以后：发起人和接的人之间这一条画在群里，不画在一对一的聊天里（0064）。 */
  groupId: Type.Optional(Nullable(IdSchema)),
}, STRICT);
export type NetworkTaskInput = Static<typeof NetworkTaskInputSchema>;
export const NetworkTaskPatchSchema = Type.Partial(Type.Object({
  state: Type.Enum(NETWORK_TASK_STATES),
  doer: Nullable(Type.Enum(NETWORK_TASK_DOERS)),
  localTaskId: Nullable(IdSchema),
  /** 「等你」的那张卡（表态或验收）；处理完就撤。 */
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

// ---------- 档位与分身说过的话 ----------

export const VisibilityMarkSchema = Type.Object({
  ...RECORD_META,
  objectKind: Type.Enum(MATERIAL_KINDS),
  objectId: IdSchema,
  /** 用户定下的档位；只有建议、还没确认时是 private（没确认 = 不对外）。 */
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
