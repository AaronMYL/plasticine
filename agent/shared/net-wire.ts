// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { NetworkAttachmentListSchema } from './network-attachments.ts';
import { TASK_DECISIONS, TASK_VERDICTS } from './api/contacts.ts';
import { OrNull as Nullable } from './api/lineage.ts';

export const NET_PREFIX = '/v2/net';
export const NET_ACCOUNTS_PATH = `${NET_PREFIX}/accounts`;
export const NET_INVITES_PATH = `${NET_PREFIX}/invites`;
export const NET_HANDLES_PATH = `${NET_PREFIX}/handles`;
export const NET_ENVELOPES_PATH = `${NET_PREFIX}/envelopes`;
export const NET_ACK_PATH = `${NET_ENVELOPES_PATH}/ack`;
export const NET_BLOCKS_PATH = `${NET_PREFIX}/blocks`;
export const NET_TASKS_PATH = `${NET_PREFIX}/tasks`;

export const NET_HEADERS = {
  account: 'x-net-account',
  time: 'x-net-time',
  nonce: 'x-net-nonce',
  signature: 'x-net-signature',
} as const;

export const NET_TIME_SKEW_MS = 5 * 60 * 1000;
export const NET_NONCE_TTL_MS = 10 * 60 * 1000;
export const NET_WAIT_MAX_SECONDS = 25;
export const NET_PAGE_MAX = 100;
export const NET_CIPHERTEXT_MAX_CHARS = 200_000;
export const NET_HANDLE_PATTERN = '^[a-z0-9_]{3,24}$';

const B64 = '^[A-Za-z0-9_-]+$';
const Base64Url = (min: number, max: number) => Type.String({ pattern: B64, minLength: min, maxLength: max });
export const PublicKeySchema = Base64Url(43, 43);
export const SignatureSchema = Base64Url(86, 86);
export const NetIdSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' });
const IsoTime = Type.String({ minLength: 1, format: 'date-time' });
const STRICT = { additionalProperties: false };

export const RegisterAccountRequestSchema = Type.Object({
  handle: Type.String({ pattern: NET_HANDLE_PATTERN }),
  displayName: Type.String({ minLength: 1, maxLength: 40 }),
  signingKey: PublicKeySchema,
  encryptionKey: PublicKeySchema,
  inviteCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, STRICT);
export type RegisterAccountRequest = Static<typeof RegisterAccountRequestSchema>;

export const NetAccountSchema = Type.Object({
  id: NetIdSchema,
  handle: Type.String(),
  displayName: Type.String(),
  signingKey: PublicKeySchema,
  encryptionKey: PublicKeySchema,
});
export type NetAccount = Static<typeof NetAccountSchema>;
export const NetAccountResponseSchema = Type.Object({
  account: NetAccountSchema,
  invitedBy: Type.Optional(Type.String()),
});

export const CreateNetInviteRequestSchema = Type.Object({
  requestId: Type.String({ pattern: '^[A-Za-z0-9_-]{8,100}$' }),
}, STRICT);
export const NetInviteSchema = Type.Object({
  code: Type.String(),
  createdAt: IsoTime,
  expiresAt: IsoTime,
  usedBy: Type.Union([Type.String(), Type.Null()]),
});
export type NetInvite = Static<typeof NetInviteSchema>;
export const NetInviteResponseSchema = Type.Object({ invite: NetInviteSchema });
export const NetInvitesResponseSchema = Type.Object({ invites: Type.Array(NetInviteSchema) });
export const NetInviteCheckSchema = Type.Object({ valid: Type.Boolean() });

export const NetHandleCheckSchema = Type.Object({
  handle: Type.String(),
  available: Type.Boolean(),
  reason: Type.Union([Type.Literal('taken'), Type.Literal('invalid'), Type.Literal('reserved'), Type.Null()]),
}, STRICT);
export type NetHandleCheck = Static<typeof NetHandleCheckSchema>;

export const ENVELOPE_KINDS = [
  'hello', 'text', 'ai_text', 'ask_ai', 'task_offer', 'task_reply', 'task_delivery', 'task_verdict', 'read',
  'profile', 'group_update', 'group_message', 'group_task', 'task_claim', 'task_cancel',
  'reaction',
] as const;
export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

export const EnvelopeSchema = Type.Object({
  id: NetIdSchema,
  from: NetIdSchema,
  to: NetIdSchema,
  sentAt: IsoTime,
  kind: Type.Enum(ENVELOPE_KINDS),
  ephemeralKey: PublicKeySchema,
  nonce: Base64Url(16, 16),
  ciphertext: Base64Url(22, NET_CIPHERTEXT_MAX_CHARS),
  signature: SignatureSchema,
}, STRICT);
export type Envelope = Static<typeof EnvelopeSchema>;

export const PostEnvelopeResponseSchema = Type.Object({ accepted: Type.Boolean() });
export const EnvelopesQuerySchema = Type.Object({
  after: Type.Optional(Type.String({ pattern: '^[0-9]{1,15}$' })),
  wait: Type.Optional(Type.Integer({ minimum: 0, maximum: NET_WAIT_MAX_SECONDS })),
});
export const EnvelopesResponseSchema = Type.Object({
  envelopes: Type.Array(EnvelopeSchema),
  cursor: Type.String(),
});
export type EnvelopesResponse = Static<typeof EnvelopesResponseSchema>;
export const AckRequestSchema = Type.Object({
  ids: Type.Array(NetIdSchema, { minItems: 1, maxItems: NET_PAGE_MAX }),
}, STRICT);
export const AckResponseSchema = Type.Object({ acked: Type.Integer({ minimum: 0 }) });

export const BlockRequestSchema = Type.Object({ accountId: NetIdSchema }, STRICT);
export const OkResponseSchema = Type.Object({ ok: Type.Literal(true) });

export const NET_TASK_STATUSES = ['offered', 'accepted', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;
export type NetTaskStatus = (typeof NET_TASK_STATUSES)[number];
export const TaskStatusRequestSchema = Type.Object({
  state: Type.Enum(NET_TASK_STATUSES),
  with: NetIdSchema,
}, STRICT);
export const NetTaskStatusSchema = Type.Object({
  taskId: NetIdSchema,
  offeredBy: NetIdSchema,
  offeredTo: NetIdSchema,
  state: Type.Enum(NET_TASK_STATUSES),
  by: NetIdSchema,
  at: IsoTime,
});
export type NetTaskStatusRecord = Static<typeof NetTaskStatusSchema>;
export const NetTaskStatusesResponseSchema = Type.Object({ statuses: Type.Array(NetTaskStatusSchema) });
export const NetTasksQuerySchema = Type.Object({ with: NetIdSchema });

const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });
const MESSAGE_MAX = 8_000;
const TASK_MAX = 20_000;
export const AVATAR_MAX_CHARS = 64_000;
export const GROUP_NAME_MAX = 40;
export const GROUP_MEMBERS_MAX = 20;
const Avatar = Nullable(Type.String({ pattern: '^data:image/(png|jpeg|webp);base64,', maxLength: AVATAR_MAX_CHARS }));
const MemberSchema = Type.Object({
  accountId: NetIdSchema,
  handle: Type.String({ pattern: NET_HANDLE_PATTERN }),
  displayName: Text(40),
}, STRICT);

export const NET_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'] as const;
const AiName = Type.Optional(Nullable(Text(40)));

export const PLAINTEXT_SCHEMAS = {
  hello: Type.Object({
    displayName: Text(40),
    note: Nullable(Type.String({ maxLength: 200 })),
    avatar: Type.Optional(Avatar),
    aiName: AiName,
  }, STRICT),
  text: Type.Object({
    text: Type.String({ maxLength: MESSAGE_MAX }),
    attachments: Type.Optional(NetworkAttachmentListSchema),
    replyTo: Nullable(NetIdSchema),
    toOwnAi: Type.Optional(Type.Boolean()),
  }, STRICT),
  ai_text: Type.Object({
    text: Type.String({ maxLength: MESSAGE_MAX }),
    attachments: Type.Optional(NetworkAttachmentListSchema),
    exchangeId: NetIdSchema,
    askerIsAi: Type.Boolean(),
  }, STRICT),
  ask_ai: Type.Object({ text: Type.String({ maxLength: MESSAGE_MAX }), exchangeId: NetIdSchema,
    fromAi: Type.Boolean(), attachments: Type.Optional(NetworkAttachmentListSchema) }, STRICT),
  task_offer: Type.Object({
    taskId: NetIdSchema,
    title: Text(120),
    goal: Text(TASK_MAX),
    acceptance: Text(2_000),
    deadline: Nullable(IsoTime),
    attachment: Nullable(Type.String({ maxLength: TASK_MAX })),
  }, STRICT),
  task_reply: Type.Object({ taskId: NetIdSchema, decision: Type.Enum(TASK_DECISIONS) }, STRICT),
  task_delivery: Type.Object({
    taskId: NetIdSchema,
    text: Text(TASK_MAX),
    attachment: Nullable(Type.String({ maxLength: TASK_MAX })),
  }, STRICT),
  task_verdict: Type.Object({
    taskId: NetIdSchema,
    verdict: Type.Enum(TASK_VERDICTS),
    note: Type.String({ maxLength: 500 }),
  }, STRICT),
  read: Type.Object({ upTo: IsoTime }, STRICT),
  profile: Type.Object({ displayName: Text(40), avatar: Avatar, aiName: AiName }, STRICT),
  group_update: Type.Object({
    groupId: NetIdSchema,
    op: Type.Union([Type.Literal('sync'), Type.Literal('leave')]),
    name: Text(GROUP_NAME_MAX),
    avatar: Avatar,
    ownerId: NetIdSchema,
    members: Type.Array(MemberSchema, { minItems: 1, maxItems: GROUP_MEMBERS_MAX }),
    at: IsoTime,
  }, STRICT),
  group_message: Type.Object({
    groupId: NetIdSchema,
    messageId: NetIdSchema,
    kind: Type.Union([Type.Literal('text'), Type.Literal('ask_ai'), Type.Literal('ai_text')]),
    text: Type.String({ maxLength: MESSAGE_MAX }),
    attachments: Type.Optional(NetworkAttachmentListSchema),
    target: Nullable(NetIdSchema),
    exchangeId: Nullable(NetIdSchema),
    replyTo: Type.Optional(Nullable(NetIdSchema)),
  }, STRICT),
  group_task: Type.Object({
    groupId: NetIdSchema,
    taskId: NetIdSchema,
    op: Type.Union([Type.Literal('offer'), Type.Literal('claimed'), Type.Literal('state'), Type.Literal('cancel')]),
    title: Text(120),
    goal: Text(TASK_MAX),
    deadline: Nullable(IsoTime),
    attachment: Nullable(Type.String({ maxLength: TASK_MAX })),
    assignee: Nullable(NetIdSchema),
    claimer: Nullable(NetIdSchema),
    doer: Nullable(Type.Union([Type.Literal('ai'), Type.Literal('person')])),
    state: Type.Union([Type.Literal('open'), Type.Literal('claimed'), Type.Literal('in_progress'),
      Type.Literal('delivered'), Type.Literal('passed'), Type.Literal('rejected'), Type.Literal('declined'),
      Type.Literal('cancelled')]),
  }, STRICT),
  task_claim: Type.Object({
    groupId: NetIdSchema,
    taskId: NetIdSchema,
    doer: Type.Union([Type.Literal('ai'), Type.Literal('person')]),
  }, STRICT),
  task_cancel: Type.Object({ taskId: NetIdSchema }, STRICT),
  reaction: Type.Object({
    messageId: NetIdSchema,
    emoji: Type.Enum(NET_REACTIONS),
    on: Type.Boolean(),
    groupId: Type.Optional(NetIdSchema),
  }, STRICT),
} as const;

export type Plaintext<K extends EnvelopeKind> = Static<(typeof PLAINTEXT_SCHEMAS)[K]>;
export type AnyPlaintext = { [K in EnvelopeKind]: { kind: K; body: Plaintext<K> } }[EnvelopeKind];
