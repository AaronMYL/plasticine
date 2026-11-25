// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { NetworkAttachmentViewSchema } from '../network-attachments.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { LineViewSchema } from './lines.ts';
import { ContactMailSchema } from './mail.ts';

export const CONTACTS_PATH = `${API_PREFIX}/contacts`;
export const CONTACTS_ADD_PATH = `${CONTACTS_PATH}/add`;
export const NETWORK_TASKS_PATH = `${API_PREFIX}/network-tasks`;
export const CONTACT_MESSAGES_PAGE = 50;
export const CONTACT_TEXT_MAX_CHARS = 8_000;
export const TASK_TEXT_MAX_CHARS = 20_000;

export const CONTACT_KINDS = ['person', 'mail', 'system', 'group'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_RELATIONS = ['stranger', 'partner', 'friend'] as const;
export type ContactRelation = (typeof CONTACT_RELATIONS)[number];
export const CONTACT_RELATION_LABELS: Readonly<Record<ContactRelation, string>> = {
  stranger: '陌生人',
  partner: '合作方',
  friend: '朋友',
};
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
  sender: Type.Optional(Type.String()),
});

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
  handle: OrNull(Type.String()),
  address: OrNull(Type.String()),
  relation: OrNull(Type.Enum(CONTACT_RELATIONS)),
  state: Type.Enum(CONTACT_STATES),
  last: OrNull(ContactPreviewSchema),
  unread: Type.Integer({ minimum: 0 }),
  waiting: Type.Boolean(),
  canSend: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
  avatar: Type.Optional(OrNull(Type.String())),
  members: Type.Optional(Type.Array(MemberFaceSchema)),
  memberCount: Type.Optional(Type.Integer({ minimum: 0 })),
  aiName: Type.Optional(OrNull(Type.String())),
  removedAt: Type.Optional(OrNull(IsoTimeSchema)),
});
export type ContactRow = Static<typeof ContactRowSchema>;

export const ContactListResponseSchema = Type.Object({
  contacts: Type.Array(ContactRowSchema),
  requests: Type.Integer({ minimum: 0 }),
  waiting: Type.Integer({ minimum: 0 }),
  unread: Type.Integer({ minimum: 0 }),
  removed: Type.Optional(Type.Array(ContactRowSchema)),
});
export type ContactListResponse = Static<typeof ContactListResponseSchema>;

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
  stage: Type.Integer({ minimum: 0, maximum: 5 }),
  waiting: Type.Boolean(),
  delivery: OrNull(Type.Object({ text: Type.String(), at: IsoTimeSchema })),
  verdict: OrNull(Type.Object({ verdict: Type.Enum(TASK_VERDICTS), note: Type.String(), at: IsoTimeSchema })),
  localTaskId: OrNull(IdSchema),
  revisionAskId: Type.Optional(OrNull(IdSchema)),
  execution: Type.Optional(OrNull(NetworkTaskExecutionSchema)),
  activity: Type.Optional(OrNull(Type.Object({ text: Type.String(), since: IsoTimeSchema }))),
  attachment: Type.Optional(OrNull(Type.String())),
  decidedAt: Type.Optional(OrNull(IsoTimeSchema)),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type NetworkTaskView = Static<typeof NetworkTaskViewSchema>;

export const ContactMessageViewSchema = Type.Object({
  attachments: Type.Optional(Type.Array(NetworkAttachmentViewSchema)),
  error: Type.Optional(OrNull(Type.String())),
  id: IdSchema,
  author: Type.Enum(MESSAGE_AUTHORS),
  text: Type.String(),
  at: IsoTimeSchema,
  status: Type.Enum(CONTACT_MESSAGE_STATUSES),
  toAi: Type.Boolean(),
  exchangeId: OrNull(IdSchema),
  taskId: OrNull(IdSchema),
  dryRun: Type.Optional(Type.Boolean()),
  mail: Type.Optional(ContactMailSchema),
  mention: Type.Optional(OrNull(Type.Object({ name: Type.String(), self: Type.Boolean() }))),
  sender: Type.Optional(OrNull(MemberFaceSchema)),
  reactions: Type.Optional(Type.Array(Type.Object({ emoji: Type.String(), mine: Type.Boolean(),
    count: Type.Integer({ minimum: 1 }) }))),
  replyTo: Type.Optional(OrNull(Type.Object({ author: Type.String(), text: Type.String() }))),
});
export type ContactMessageView = Static<typeof ContactMessageViewSchema>;

export const GROUP_TASK_STATES = ['open', 'claimed', 'in_progress', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;

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
  claiming: Type.Boolean(),
  canClaim: Type.Boolean(),
  members: Type.Array(MemberFaceSchema),
  pair: OrNull(NetworkTaskViewSchema),
  offeredAt: IsoTimeSchema,
  claimedAt: OrNull(IsoTimeSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type GroupTaskView = Static<typeof GroupTaskViewSchema>;

export const ContactThreadItemSchema = Type.Union([
  Type.Object({ type: Type.Literal('message'), message: ContactMessageViewSchema }),
  Type.Object({ type: Type.Literal('task'), at: IsoTimeSchema, task: NetworkTaskViewSchema }),
  Type.Object({ type: Type.Literal('group_task'), at: IsoTimeSchema, task: GroupTaskViewSchema }),
  Type.Object({
    type: Type.Literal('exchange'),
    id: IdSchema,
    at: IsoTimeSchema,
    count: Type.Integer({ minimum: 1 }),
    summary: Type.String(),
    messages: Type.Array(ContactMessageViewSchema),
  }),
]);
export type ContactThreadItem = Static<typeof ContactThreadItemSchema>;

export const ContactMessagesQuerySchema = Type.Object({ before: Type.Optional(IsoTimeSchema) });
export const ContactMessagesResponseSchema = Type.Object({
  items: Type.Array(ContactThreadItemSchema),
  hasMore: Type.Boolean(),
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

export const ContactMemorySchema = Type.Object({
  doc: OrNull(Type.Object({ id: IdSchema, title: Type.String() })),
  suggest: OrNull(Type.Object({ id: IdSchema, title: Type.String() })),
  lines: Type.Array(Type.Object({ text: Type.String(), by: Type.String(), at: IsoTimeSchema })),
  people: Type.Array(Type.Object({ id: IdSchema, title: Type.String(), linked: Type.Array(Type.String()) })),
});
export type ContactMemory = Static<typeof ContactMemorySchema>;

export const ContactDetailSchema = Type.Object({
  contact: ContactRowSchema,
  memory: Type.Optional(ContactMemorySchema),
  tierCap: OrNull(Type.String()),
  deliveries: Type.Array(DeliveryEntrySchema),
  said: Type.Array(SaidEntrySchema),
  safetyCode: OrNull(Type.String()),
  safetyChanged: Type.Boolean(),
  members: Type.Optional(Type.Array(MemberFaceSchema)),
});
export type ContactDetail = Static<typeof ContactDetailSchema>;

export const SendContactMessageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ maxLength: CONTACT_TEXT_MAX_CHARS }),
  attachmentIds: Type.Optional(Type.Array(IdSchema, { maxItems: 5, uniqueItems: true })),
  target: Type.Optional(Type.Union([Type.Literal('person'), Type.Literal('ai'), Type.Literal('mine')])),
  aiOf: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  alsoAiOf: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 8, uniqueItems: true })),
  replyToId: Type.Optional(IdSchema),
});
export const SendContactMessageResponseSchema = Type.Object({ message: ContactMessageViewSchema });

export const CONTACT_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'] as const;
export const ContactReactionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  emoji: Type.Enum(CONTACT_REACTIONS),
  on: Type.Boolean(),
});
export const ContactAliasRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  alias: OrNull(Type.String({ maxLength: 40 })),
});
export const ContactPersonRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  docId: Type.Optional(OrNull(IdSchema)),
  create: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  dismiss: Type.Optional(Type.Boolean()),
});
export const ContactRemoveRequestSchema = Type.Object({ requestId: RequestIdSchema });

export const AddContactRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  handle: Type.String({ minLength: 3, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 200 })),
});
export const CONTACT_LOOKUP_PATH = `${CONTACTS_PATH}/lookup`;
export const ContactLookupQuerySchema = Type.Object({ handle: Type.String({ minLength: 1, maxLength: 200 }) });
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
export const ConfirmSafetyRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
});

export const CreateNetworkTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  goal: Type.String({ minLength: 1, maxLength: TASK_TEXT_MAX_CHARS }),
  acceptance: Type.Optional(Type.String({ maxLength: 2_000 })),
  deadline: Type.Optional(OrNull(IsoTimeSchema)),
  attachment: Type.Optional(OrNull(Type.String({ maxLength: TASK_TEXT_MAX_CHARS }))),
  assignee: Type.Optional(OrNull(Type.String({ minLength: 1, maxLength: 64 }))),
});
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

export const GROUPS_PATH = `${API_PREFIX}/groups`;
export const GROUP_TASKS_PATH = `${API_PREFIX}/group-tasks`;
export const GROUP_ID_PREFIX = 'grp-';

export const CreateGroupRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  name: Type.Optional(Type.String({ maxLength: 40 })),
  memberIds: Type.Array(IdSchema, { minItems: 1, maxItems: 19 }),
});
export const UpdateGroupRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  avatar: Type.Optional(OrNull(Type.String({ maxLength: 64_000 }))),
  addIds: Type.Optional(Type.Array(IdSchema, { maxItems: 19 })),
});
export const GroupRequestSchema = Type.Object({ requestId: RequestIdSchema });
export const ClaimGroupTaskRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  doer: Type.Enum(NETWORK_TASK_DOERS),
});
export const GroupTaskResponseSchema = Type.Object({ task: GroupTaskViewSchema });

export const ContactsChangedEventSchema = Type.Object({
  type: Type.Literal('contacts_changed'),
  waiting: Type.Integer({ minimum: 0 }),
  unread: Type.Integer({ minimum: 0 }),
});
export const ContactItemEventSchema = Type.Object({
  type: Type.Literal('contact_item'),
  contactId: IdSchema,
  item: ContactThreadItemSchema,
});
