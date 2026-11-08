// /v2/contacts: 联系人（第 113 条，docs/specs/contacts-network.md 第 6 节）。一张并好的列表：网络上的人、站内信里的邮件
// （按发件地址归并）、系统来源（巡查、反馈、Cyber Hunter、采访）。聊天里左右 = 谁的，author 说是人还是 AI；
// 同一段 AI↔AI 沟通在服务端收成一项 exchange。任务卡、交付记录、分身说过的话都挂在联系人上。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { LineViewSchema } from './lines.ts';
import { ContactMailSchema } from './mail.ts';

export const CONTACTS_PATH = `${API_PREFIX}/contacts`;
export const CONTACTS_ADD_PATH = `${CONTACTS_PATH}/add`;
export const NETWORK_TASKS_PATH = `${API_PREFIX}/network-tasks`;
/** 一页 50 条消息。 */
export const CONTACT_MESSAGES_PAGE = 50;
export const CONTACT_TEXT_MAX_CHARS = 8_000;
export const TASK_TEXT_MAX_CHARS = 20_000;

/** group = 群聊（2026-11-05）：同一张列表、同一套聊天接口，id 以 grp- 开头。 */
export const CONTACT_KINDS = ['person', 'mail', 'system', 'group'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_RELATIONS = ['stranger', 'partner', 'friend'] as const;
export type ContactRelation = (typeof CONTACT_RELATIONS)[number];
export const CONTACT_RELATION_LABELS: Readonly<Record<ContactRelation, string>> = {
  stranger: '陌生人',
  partner: '合作方',
  friend: '朋友',
};
/**
 * request = 对方发来、我还没接受；pending = 我加了对方、对方还没回；member = 只在同一个群里见过（不是好友，不进
 * 联系人列表，只为了给群里的人加密发信记下他的公钥）。
 */
export const CONTACT_STATES = ['request', 'pending', 'active', 'blocked', 'member'] as const;
export type ContactState = (typeof CONTACT_STATES)[number];
export const MESSAGE_AUTHORS = ['me', 'them', 'my_ai', 'their_ai', 'system'] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];
export const CONTACT_MESSAGE_STATUSES = ['sending', 'sent', 'failed'] as const;

export const NETWORK_TASK_STATES = [
  'offered', 'accepted', 'in_progress', 'delivered', 'passed', 'rejected', 'declined', 'cancelled',
] as const;
export type NetworkTaskState = (typeof NETWORK_TASK_STATES)[number];
export const NETWORK_TASK_DOERS = ['ai', 'person'] as const;
export const TASK_DECISIONS = ['by_ai', 'by_person', 'decline'] as const;
export const TASK_VERDICTS = ['pass', 'reject'] as const;

const ContactPreviewSchema = Type.Object({
  text: Type.String(),
  at: IsoTimeSchema,
  author: Type.Enum(MESSAGE_AUTHORS),
  /** 群里别人说的：谁说的（列表预览「周可：我来接」）。 */
  sender: Type.Optional(Type.String()),
});

/** 群头像拼图里的一格、群卡上的一个人：名字、头像（没有就画名字首字）、是不是我。 */
export const MemberFaceSchema = Type.Object({
  accountId: Type.String(),
  name: Type.String(),
  handle: Type.String(),
  avatar: OrNull(Type.String()),
  self: Type.Boolean(),
});
export type MemberFace = Static<typeof MemberFaceSchema>;

export const ContactRowSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(CONTACT_KINDS),
  name: Type.String(),
  /** 网络上的人才有：@handle（不带 @）。 */
  handle: OrNull(Type.String()),
  /** 邮件地址或系统来源的 inbox source。 */
  address: OrNull(Type.String()),
  relation: OrNull(Type.Enum(CONTACT_RELATIONS)),
  state: Type.Enum(CONTACT_STATES),
  last: OrNull(ContactPreviewSchema),
  unread: Type.Integer({ minimum: 0 }),
  /** 等你：对方的请求、待我表态或验收的任务、分身等我确认。 */
  waiting: Type.Boolean(),
  /** 只读来源（巡查、反馈这些）不能发。 */
  canSend: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
  /** 头像（data URL）：人是他发来的，群是换过的群头像；没有就由界面画（人：名字首字；群：前 9 个成员拼）。 */
  avatar: Type.Optional(OrNull(Type.String())),
  /** 群：前 9 个成员（拼头像）和人数。 */
  members: Type.Optional(Type.Array(MemberFaceSchema)),
  memberCount: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type ContactRow = Static<typeof ContactRowSchema>;

export const ContactListResponseSchema = Type.Object({
  contacts: Type.Array(ContactRowSchema),
  /** 「新请求」一行的数。 */
  requests: Type.Integer({ minimum: 0 }),
  waiting: Type.Integer({ minimum: 0 }),
  unread: Type.Integer({ minimum: 0 }),
});
export type ContactListResponse = Static<typeof ContactListResponseSchema>;

/** 本机执行状态直接投影自线；任务的交付、验收阶段仍由两端任务记录表示。 */
export const NetworkTaskExecutionSchema = Type.Pick(LineViewSchema,
  ['status', 'pauseReason', 'outcome', 'pausedUntil', 'failure', 'queued']);
export type NetworkTaskExecution = Static<typeof NetworkTaskExecutionSchema>;

export const NetworkTaskViewSchema = Type.Object({
  id: IdSchema,
  direction: Type.Union([Type.Literal('out'), Type.Literal('in')]),
  contactId: IdSchema,
  title: Type.String(),
  goal: Type.String(),
  acceptance: Type.String(),
  deadline: OrNull(IsoTimeSchema),
  state: Type.Enum(NETWORK_TASK_STATES),
  doer: OrNull(Type.Enum(NETWORK_TASK_DOERS)),
  /** 五段进度：发出 · 点头 · 在做 · 交付 · 验收，0–5 段已完成。 */
  stage: Type.Integer({ minimum: 0, maximum: 5 }),
  /** 等我：对方发来待表态、退回待补充、我该交付、对方交付了待我验收。 */
  waiting: Type.Boolean(),
  delivery: OrNull(Type.Object({ text: Type.String(), at: IsoTimeSchema })),
  verdict: OrNull(Type.Object({ verdict: Type.Enum(TASK_VERDICTS), note: Type.String(), at: IsoTimeSchema })),
  /** 本机执行这条任务的线 id（by_ai 时）。 */
  localTaskId: OrNull(IdSchema),
  /** 没有具体修改意见时，补充要求或本人接手的那张现有卡；不创建第二套返工状态。 */
  revisionAskId: Type.Optional(OrNull(IdSchema)),
  execution: Type.Optional(OrNull(NetworkTaskExecutionSchema)),
  /** 本机 Plasticine 在做时这会儿在做的那一步（「在核对营业时间…」）和从什么时候起。 */
  activity: Type.Optional(OrNull(Type.Object({ text: Type.String(), since: IsoTimeSchema }))),
  /** 发卡时附的资料（文字）。 */
  attachment: Type.Optional(OrNull(Type.String())),
  /** 点头（表态）的时间：在做的计时从这里起。 */
  decidedAt: Type.Optional(OrNull(IsoTimeSchema)),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type NetworkTaskView = Static<typeof NetworkTaskViewSchema>;

export const ContactMessageViewSchema = Type.Object({
  id: IdSchema,
  author: Type.Enum(MESSAGE_AUTHORS),
  text: Type.String(),
  at: IsoTimeSchema,
  status: Type.Enum(CONTACT_MESSAGE_STATUSES),
  /** 发给对方的 Plasticine 的问题。 */
  toAi: Type.Boolean(),
  exchangeId: OrNull(IdSchema),
  taskId: OrNull(IdSchema),
  /** 邮件回复在开发期干跑里只记下、没有发出去（第 8 条）；没有这一项就是照常。 */
  dryRun: Type.Optional(Type.Boolean()),
  /**
   * 一封来信（2026-11-04 用户定：点开是整宽阅读区，不进气泡）：标题、发件人分开给，text 是纯文字正文（搜索、预览用）；
   * 正文按 /v2/contacts/:id/mail/:mailId 点开再取。
   */
  mail: Type.Optional(ContactMailSchema),
  /** 这句 @ 了谁的 Plasticine（「@✦小林的 Plasticine …」）：self = 我的。 */
  mention: Type.Optional(OrNull(Type.Object({ name: Type.String(), self: Type.Boolean() }))),
  /** 群里：谁说的（人话是他，AI 的话是它的主人）。 */
  sender: Type.Optional(OrNull(MemberFaceSchema)),
});
export type ContactMessageView = Static<typeof ContactMessageViewSchema>;

export const GROUP_TASK_STATES = ['open', 'claimed', 'in_progress', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;

/** 群里的任务卡：发卡的人、指给谁（null = 全群谁先接谁做）、谁接到了、进度；我是两端之一时带那条一对一任务。 */
export const GroupTaskViewSchema = Type.Object({
  id: IdSchema,
  groupId: IdSchema,
  title: Type.String(),
  goal: Type.String(),
  deadline: OrNull(IsoTimeSchema),
  attachment: OrNull(Type.String()),
  owner: MemberFaceSchema,
  assignee: OrNull(MemberFaceSchema),
  claimer: OrNull(MemberFaceSchema),
  doer: OrNull(Type.Enum(NETWORK_TASK_DOERS)),
  state: Type.Enum(GROUP_TASK_STATES),
  /** 我点了「我来接」、还在等发卡的人那台定。 */
  claiming: Type.Boolean(),
  /** 我现在能接（还没人接、指给全群或指给我、不是我发的）。 */
  canClaim: Type.Boolean(),
  /** 群里的人（「全群 · 谁先接谁做」旁边那串小头像，最多 5 个）。 */
  members: Type.Array(MemberFaceSchema),
  pair: OrNull(NetworkTaskViewSchema),
  offeredAt: IsoTimeSchema,
  claimedAt: OrNull(IsoTimeSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type GroupTaskView = Static<typeof GroupTaskViewSchema>;

/** 聊天里的一项：一句话、一张任务卡，或一段折起来的 AI↔AI 沟通。 */
export const ContactThreadItemSchema = Type.Union([
  Type.Object({ type: Type.Literal('message'), message: ContactMessageViewSchema }),
  Type.Object({ type: Type.Literal('task'), at: IsoTimeSchema, task: NetworkTaskViewSchema }),
  Type.Object({ type: Type.Literal('group_task'), at: IsoTimeSchema, task: GroupTaskViewSchema }),
  Type.Object({
    type: Type.Literal('exchange'),
    id: IdSchema,
    at: IsoTimeSchema,
    count: Type.Integer({ minimum: 1 }),
    /** 最后一条 AI 消息的第一句，≤ 30 字。 */
    summary: Type.String(),
    messages: Type.Array(ContactMessageViewSchema),
  }),
]);
export type ContactThreadItem = Static<typeof ContactThreadItemSchema>;

export const ContactMessagesQuerySchema = Type.Object({ before: Type.Optional(IsoTimeSchema) });
export const ContactMessagesResponseSchema = Type.Object({
  items: Type.Array(ContactThreadItemSchema),
  hasMore: Type.Boolean(),
  /** 预测一句：有就给，输入框灰字，Tab 采用。 */
  suggestion: OrNull(Type.String()),
});
export type ContactMessagesResponse = Static<typeof ContactMessagesResponseSchema>;

export const SaidEntrySchema = Type.Object({
  id: IdSchema,
  text: Type.String(),
  tier: Type.String(),
  at: IsoTimeSchema,
});
export type SaidEntry = Static<typeof SaidEntrySchema>;

export const DeliveryEntrySchema = Type.Object({
  taskId: IdSchema,
  title: Type.String(),
  direction: Type.Union([Type.Literal('out'), Type.Literal('in')]),
  state: Type.Enum(NETWORK_TASK_STATES),
  at: IsoTimeSchema,
});
export type DeliveryEntry = Static<typeof DeliveryEntrySchema>;

export const ContactDetailSchema = Type.Object({
  contact: ContactRowSchema,
  /** 单独调整的档位上限，没有就按 relation。 */
  tierCap: OrNull(Type.String()),
  deliveries: Type.Array(DeliveryEntrySchema),
  said: Type.Array(SaidEntrySchema),
  /** 12 组 5 位数字；邮件和系统来源为 null。 */
  safetyCode: OrNull(Type.String()),
  safetyChanged: Type.Boolean(),
  /** 群：全部成员（含我，进群先后）。 */
  members: Type.Optional(Type.Array(MemberFaceSchema)),
});
export type ContactDetail = Static<typeof ContactDetailSchema>;

export const SendContactMessageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: CONTACT_TEXT_MAX_CHARS }),
  /** 一对一：给人；ai = 问对方的 Plasticine；mine = @ 我自己的（照对方能听到的档位答）。 */
  target: Type.Optional(Type.Union([Type.Literal('person'), Type.Literal('ai'), Type.Literal('mine')])),
  /** 群里：问谁的 Plasticine（成员的账号 id，可以是我自己的）。 */
  aiOf: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export const SendContactMessageResponseSchema = Type.Object({ message: ContactMessageViewSchema });

/** 加好友：@handle、handle.cyberhunter.top、https://handle.cyberhunter.top/add 这几种写法都认（服务端拆出 handle）。 */
export const AddContactRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  handle: Type.String({ minLength: 3, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 200 })),
});
export const CONTACT_LOOKUP_PATH = `${CONTACTS_PATH}/lookup`;
export const ContactLookupQuerySchema = Type.Object({ handle: Type.String({ minLength: 1, maxLength: 200 }) });
/** 按账号号找人（加好友表单下面那张预览）：网络上的名字、@handle；已经是联系人时带他在本机的 id 和状态。 */
export const ContactLookupResponseSchema = Type.Object({
  account: OrNull(Type.Object({ handle: Type.String(), displayName: Type.String() })),
  contactId: OrNull(IdSchema),
  state: OrNull(Type.Enum(CONTACT_STATES)),
});
export type ContactLookupResponse = Static<typeof ContactLookupResponseSchema>;
export const ContactRowResponseSchema = Type.Object({ contact: ContactRowSchema });

export const ContactRequestDecisionSchema = Type.Object({
  requestId: RequestIdSchema,
  decision: Type.Union([Type.Literal('accept'), Type.Literal('block'), Type.Literal('ignore')]),
});
export const SetContactRelationRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  relation: Type.Optional(Type.Enum(CONTACT_RELATIONS)),
  tierCap: Type.Optional(OrNull(Type.String())),
});
export const ReadContactRequestSchema = Type.Object({ requestId: RequestIdSchema, upTo: IsoTimeSchema });
/** 核对过安全码：换上对方的新钥匙（safetyChanged 时才有用）。 */
export const ConfirmSafetyRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
});

export const CreateNetworkTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  goal: Type.String({ minLength: 1, maxLength: TASK_TEXT_MAX_CHARS }),
  /** 不写就照「要做到」验。 */
  acceptance: Type.Optional(Type.String({ maxLength: 2_000 })),
  deadline: Type.Optional(OrNull(IsoTimeSchema)),
  /** 资料（文字，≤ 2 万字）。 */
  attachment: Type.Optional(OrNull(Type.String({ maxLength: TASK_TEXT_MAX_CHARS }))),
  /** 群里：指给谁（成员账号 id）；不给 = 全群谁先接谁做。一对一忽略。 */
  assignee: Type.Optional(OrNull(Type.String({ minLength: 1, maxLength: 64 }))),
});
/** 撤回（我发出、对方还没点头的）、停止（本机 Plasticine 在做的，改成我自己做）。 */
export const NetworkTaskVersionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
});
export const DecideNetworkTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  decision: Type.Enum(TASK_DECISIONS),
});
export const DeliverNetworkTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1, maxLength: TASK_TEXT_MAX_CHARS }),
});
export const VerdictNetworkTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  verdict: Type.Enum(TASK_VERDICTS),
  note: Type.Optional(Type.String({ maxLength: 500 })),
});
export const NetworkTaskResponseSchema = Type.Object({ task: NetworkTaskViewSchema });

// ---------- 群 ----------

export const GROUPS_PATH = `${API_PREFIX}/groups`;
export const GROUP_TASKS_PATH = `${API_PREFIX}/group-tasks`;
export const GROUP_ID_PREFIX = 'grp-';

export const CreateGroupRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  name: Type.Optional(Type.String({ maxLength: 40 })),
  /** 拉进来的好友（联系人 id）。 */
  memberIds: Type.Array(IdSchema, { minItems: 1, maxItems: 19 }),
});
export const UpdateGroupRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  /** 换群头像（data URL）；null = 换回成员拼的。 */
  avatar: Type.Optional(OrNull(Type.String({ maxLength: 64_000 }))),
  addIds: Type.Optional(Type.Array(IdSchema, { maxItems: 19 })),
});
export const GroupRequestSchema = Type.Object({ requestId: RequestIdSchema });
export const ClaimGroupTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  doer: Type.Enum(NETWORK_TASK_DOERS),
});
export const GroupTaskResponseSchema = Type.Object({ task: GroupTaskViewSchema });

/** SSE：列表变了（等你、未读一起带上）。 */
export const ContactsChangedEventSchema = Type.Object({
  type: Type.Literal('contacts_changed'),
  waiting: Type.Integer({ minimum: 0 }),
  unread: Type.Integer({ minimum: 0 }),
});
/** SSE：某个联系人的聊天里多了一项（或一项变了）。 */
export const ContactItemEventSchema = Type.Object({
  type: Type.Literal('contact_item'),
  contactId: IdSchema,
  item: ContactThreadItemSchema,
});
