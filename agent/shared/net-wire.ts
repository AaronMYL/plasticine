// SPDX-License-Identifier: Apache-2.0
// Cyber Hunter 网络的线上格式（第 113 条，docs/specs/contacts-network.md 第 2–4 节）：中继接口 /v2/net/* 的请求与
// 回答、信封、信封里的明文。中继（agent/src/network-relay/）和每个实例的客户端（agent/src/network/）共用这一份；
// 界面不用它（界面的接口在 shared/api/contacts.ts、network.ts、visibility.ts）。
// 二进制一律 base64url（不带 =）：出口清洗只碰带 // 的文字，base64 的 / 可能连成 //，base64url 不会。

import { Type, type Static } from 'typebox';
import { NetworkAttachmentListSchema } from './network-attachments.ts';
import { TASK_DECISIONS, TASK_VERDICTS } from './api/contacts.ts';
import { OrNull as Nullable } from './api/lineage.ts';

export const NET_PREFIX = '/v2/net';
export const NET_ACCOUNTS_PATH = `${NET_PREFIX}/accounts`;
export const NET_INVITES_PATH = `${NET_PREFIX}/invites`;
/** GET …/handles/:handle（不要签名）：这个 @handle 能不能注册（2026-11-08 自助注册）。 */
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

/** 规格第 2 节：请求时间和中继的钟差超过 5 分钟拒绝；同一个 nonce 10 分钟内再来拒绝。 */
export const NET_TIME_SKEW_MS = 5 * 60 * 1000;
export const NET_NONCE_TTL_MS = 10 * 60 * 1000;
/** 长轮询最多等 25 秒：比代理掐断安静连接的一分钟短，和 SSE 心跳同一个数（app/config.ts）。 */
export const NET_WAIT_MAX_SECONDS = 25;
/** 一次长轮询最多带回的信封数。 */
export const NET_PAGE_MAX = 100;
// 任务附件 ≤ 2 万字（规格第 4 节），UTF-8 中文三字节、JSON 转义、base64url 再大三分之一：留到 20 万字符。
export const NET_CIPHERTEXT_MAX_CHARS = 200_000;
export const NET_HANDLE_PATTERN = '^[a-z0-9_]{3,24}$';

const B64 = '^[A-Za-z0-9_-]+$';
const Base64Url = (min: number, max: number) => Type.String({ pattern: B64, minLength: min, maxLength: max });
// Ed25519 / X25519 公钥 32 字节 = 43 个 base64url 字符；Ed25519 签名 64 字节 = 86 个。
export const PublicKeySchema = Base64Url(43, 43);
export const SignatureSchema = Base64Url(86, 86);
export const NetIdSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' });
const IsoTime = Type.String({ minLength: 1, format: 'date-time' });
const STRICT = { additionalProperties: false };

// ---------- 账号与邀请码 ----------

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
  /** 注册时用了谁的邀请码（他的 handle）：加入后自动给他发好友请求。 */
  invitedBy: Type.Optional(Type.String()),
});

export const CreateNetInviteRequestSchema = Type.Object({
  /** 同一个 requestId 再来拿回同一个码（客户端重发不多生成）。 */
  requestId: Type.String({ pattern: '^[A-Za-z0-9_-]{8,100}$' }),
}, STRICT);
export const NetInviteSchema = Type.Object({
  code: Type.String(),
  createdAt: IsoTime,
  expiresAt: IsoTime,
  /** 用掉它的账号的 handle；没用是 null。 */
  usedBy: Type.Union([Type.String(), Type.Null()]),
});
export type NetInvite = Static<typeof NetInviteSchema>;
export const NetInviteResponseSchema = Type.Object({ invite: NetInviteSchema });
export const NetInvitesResponseSchema = Type.Object({ invites: Type.Array(NetInviteSchema) });
export const NetInviteCheckSchema = Type.Object({ valid: Type.Boolean() });

/** 一个 @handle 能不能注册：不能时说是被占了、格式不对，还是留给系统用的词。 */
export const NetHandleCheckSchema = Type.Object({
  handle: Type.String(),
  available: Type.Boolean(),
  reason: Type.Union([Type.Literal('taken'), Type.Literal('invalid'), Type.Literal('reserved'), Type.Null()]),
}, STRICT);
export type NetHandleCheck = Static<typeof NetHandleCheckSchema>;

// ---------- 信封 ----------

export const ENVELOPE_KINDS = [
  'hello', 'text', 'ai_text', 'ask_ai', 'task_offer', 'task_reply', 'task_delivery', 'task_verdict', 'read',
  // 2026-11-05 第二批：资料（头像）、群（发件方给每个成员各发一封）、群任务的认领、撤回任务。
  'profile', 'group_update', 'group_message', 'group_task', 'task_claim', 'task_cancel',
] as const;
export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

/** 中继看得到的只有这些：谁发给谁、什么时候、哪一类；正文是密文。 */
export const EnvelopeSchema = Type.Object({
  id: NetIdSchema,
  from: NetIdSchema,
  to: NetIdSchema,
  sentAt: IsoTime,
  kind: Type.Enum(ENVELOPE_KINDS),
  /** 这封信自己的临时 X25519 公钥。 */
  ephemeralKey: PublicKeySchema,
  /** AES-256-GCM 的 12 字节随机数。 */
  nonce: Base64Url(16, 16),
  /** 密文连同 16 字节认证标签。 */
  ciphertext: Base64Url(22, NET_CIPHERTEXT_MAX_CHARS),
  /** 发件人 Ed25519 对整个信封（除了这一项）的签名。 */
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
  /** 下一次 after 带这个。 */
  cursor: Type.String(),
});
export type EnvelopesResponse = Static<typeof EnvelopesResponseSchema>;
export const AckRequestSchema = Type.Object({
  ids: Type.Array(NetIdSchema, { minItems: 1, maxItems: NET_PAGE_MAX }),
}, STRICT);
export const AckResponseSchema = Type.Object({ acked: Type.Integer({ minimum: 0 }) });

// ---------- 拉黑与任务状态 ----------

export const BlockRequestSchema = Type.Object({ accountId: NetIdSchema }, STRICT);
export const OkResponseSchema = Type.Object({ ok: Type.Literal(true) });

/** 中继记的任务状态（明文，只有两端能写，用来算交付记录）。「在做」只在两端本地有。 */
export const NET_TASK_STATUSES = ['offered', 'accepted', 'delivered', 'passed', 'rejected', 'declined',
  'cancelled'] as const;
export type NetTaskStatus = (typeof NET_TASK_STATUSES)[number];
export const TaskStatusRequestSchema = Type.Object({
  state: Type.Enum(NET_TASK_STATUSES),
  /** 另一端的账号 id。第一条（offered）定下两端是谁。 */
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

// ---------- 信封里的明文（规格第 4 节；kind 也在 AAD 里） ----------

const Text = (max: number) => Type.String({ minLength: 1, maxLength: max });
// 一句话的上限和界面一致（shared/api/contacts.ts CONTACT_TEXT_MAX_CHARS、TASK_TEXT_MAX_CHARS）。
const MESSAGE_MAX = 8_000;
const TASK_MAX = 20_000;
/** 头像是裁好的小图（data URL，最多 64k 字符：256px 的 JPEG 绰绰有余，整封信还在密文上限以内）。 */
export const AVATAR_MAX_CHARS = 64_000;
export const GROUP_NAME_MAX = 40;
/** 一个群最多这么多人（一句话要发这么多封；中继每分钟 60 封的限速下还能聊）。 */
export const GROUP_MEMBERS_MAX = 20;
const Avatar = Nullable(Type.String({ pattern: '^data:image/(png|jpeg|webp);base64,', maxLength: AVATAR_MAX_CHARS }));
const MemberSchema = Type.Object({
  accountId: NetIdSchema,
  handle: Type.String({ pattern: NET_HANDLE_PATTERN }),
  displayName: Text(40),
}, STRICT);

export const PLAINTEXT_SCHEMAS = {
  hello: Type.Object({
    displayName: Text(40),
    note: Nullable(Type.String({ maxLength: 200 })),
    avatar: Type.Optional(Avatar),
  }, STRICT),
  text: Type.Object({
    text: Type.String({ maxLength: MESSAGE_MAX }),
    attachments: Type.Optional(NetworkAttachmentListSchema),
    replyTo: Nullable(NetIdSchema),
    /** 这句是 @ 发件人自己的 Plasticine 说的（它接着用 ai_text 回）。 */
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
  profile: Type.Object({ displayName: Text(40), avatar: Avatar }, STRICT),
  /** 群的样子（全量）：建群、加人、改名、换头像都发这一封给每个成员；leave = 发件人自己退出。 */
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
    /** ask_ai：问谁的 Plasticine；ai_text：谁的 Plasticine 在答。 */
    target: Nullable(NetIdSchema),
    exchangeId: Nullable(NetIdSchema),
  }, STRICT),
  /** 群任务卡：发出（offer）、谁接到了（claimed）、进度（state）、撤回（cancel）。都由发起人发给每个成员。 */
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
  /** 群任务「我来接 / 让 Plasticine 接」：发给发起人，发起人那台按收到的先后定谁接到。 */
  task_claim: Type.Object({
    groupId: NetIdSchema,
    taskId: NetIdSchema,
    doer: Type.Union([Type.Literal('ai'), Type.Literal('person')]),
  }, STRICT),
  /** 发起人撤回还没人点头的任务。 */
  task_cancel: Type.Object({ taskId: NetIdSchema }, STRICT),
} as const;

export type Plaintext<K extends EnvelopeKind> = Static<(typeof PLAINTEXT_SCHEMAS)[K]>;
export type AnyPlaintext = { [K in EnvelopeKind]: { kind: K; body: Plaintext<K> } }[EnvelopeKind];
