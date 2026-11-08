// 站内信与工具组的共同状态（《UI 方案》第 9 节）。站内信是用户所有邮件和消息的入口：Gmail（IMAP 只读）、反馈、巡查
// 建议、Plasticine 自己的通知副本、Cyber Hunter、采访。邮件和别人的消息是外部资料，可以给脑看，里面的话不是指令。
// 工具组：脑的工具按组开关，开关是用户确认字段（只经本人会话确认写入，模型工具写不到）。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { CONFIRMATION_META, IdSchema, IsoTimeSchema, Nullable, OBJECT_META, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

// 1ca0391 inbox.ts 的六种来源；「十个分类」= 全部 · 未读 · 六种来源 · 收藏 · 归档。
export const INBOX_SOURCES = ['email', 'feedback', 'patrol', 'plasticine', 'cyber-hunter', 'interview'] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];
export const INBOX_TITLE_MAX_CHARS = 200;
// 1ca0391 inbox.ts：正文最多 40 000 字。
export const INBOX_BODY_MAX_CHARS = 40_000;
export const INBOX_ATTACHMENTS_MAX = 30;
// 清洗后的 HTML 上限：一封 HTML 信通常 50–200 KB；超过 2 MB 的多半把整张图 base64 写进了 HTML，只存文字。
export const INBOX_HTML_MAX_CHARS = 2_000_000;
// 原信、内嵌分段在状态目录下的相对路径（mail/raw/<id>.eml、mail/parts/<id>/<n>）。
export const INBOX_FILE_PATH_MAX_CHARS = 300;

/** 一封邮件按整封 MIME 解析出来的东西（收信时一起存；mail.refetch 原地补给旧的那几行）。 */
const MAIL_BODY_FIELDS = {
  // 清洗后的 HTML（cloud-tools/mail-sanitize.ts）；只有纯文字的信是 null。
  bodyHtml: Nullable(Type.String({ maxLength: INBOX_HTML_MAX_CHARS })),
  // 原信落盘的相对路径和 SHA-256；太大只抓了文字和内嵌图分段的信没有原信（null）。
  rawPath: Nullable(Type.String({ minLength: 1, maxLength: INBOX_FILE_PATH_MAX_CHARS })),
  rawSha256: Nullable(Type.String({ pattern: '^[0-9a-f]{64}$' })),
  // 在 Gmail 的位置：哪个邮箱（INBOX / [Gmail]/All Mail）、UIDVALIDITY 和 UID。
  imapUid: Nullable(Type.Integer({ minimum: 1 })),
  uidValidity: Nullable(Type.Integer({ minimum: 1 })),
  mailbox: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  // 整封按 MIME 解析好的时间；null = 还是旧版只抓了一个文字分段的那种（mail.refetch 要补）。
  mimeAt: Nullable(IsoTimeSchema),
};

export const InboxMessageInputSchema = Type.Object(
  {
    source: Type.Enum(INBOX_SOURCES),
    fromAddress: Type.String({ minLength: 1, maxLength: 200 }),
    fromName: Type.Optional(Nullable(Type.String({ maxLength: 100 }))),
    title: Type.String({ minLength: 1, maxLength: INBOX_TITLE_MAX_CHARS }),
    body: Type.String({ maxLength: INBOX_BODY_MAX_CHARS }),
    receivedAt: IsoTimeSchema,
    // 巡查建议：要 Plasticine 直接去做的。
    act: Type.Optional(Type.Boolean()),
    attachments: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: INBOX_ATTACHMENTS_MAX }),
    ),
    // 邮件的 Message-ID：同一封再收一次拿回原来那一条。
    messageId: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 300 }))),
    toAddress: Type.Optional(Nullable(Type.String({ maxLength: 300 }))),
    // 关联的东西，比如采访题 interview:<id>。
    ref: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 80 }))),
    readAt: Type.Optional(Nullable(IsoTimeSchema)),
    bodyHtml: Type.Optional(MAIL_BODY_FIELDS.bodyHtml),
    rawPath: Type.Optional(MAIL_BODY_FIELDS.rawPath),
    rawSha256: Type.Optional(MAIL_BODY_FIELDS.rawSha256),
    imapUid: Type.Optional(MAIL_BODY_FIELDS.imapUid),
    uidValidity: Type.Optional(MAIL_BODY_FIELDS.uidValidity),
    mailbox: Type.Optional(MAIL_BODY_FIELDS.mailbox),
    mimeAt: Type.Optional(MAIL_BODY_FIELDS.mimeAt),
  },
  STRICT,
);
export type InboxMessageInput = Static<typeof InboxMessageInputSchema>;
export const InboxMessagePatchSchema = Type.Partial(
  Type.Object({
    readAt: Nullable(IsoTimeSchema),
    starredAt: Nullable(IsoTimeSchema),
    archivedAt: Nullable(IsoTimeSchema),
    handledAt: Nullable(IsoTimeSchema),
    handledNote: Nullable(Type.String({ maxLength: 500 })),
    // 迁移 0052：这封是另一封（留下的那封的 id）的重复，显示时收起，行不删。
    duplicateOf: Nullable(IdSchema),
    // 迁移 0052：mail.refetch 在 Gmail 里找过、没找到的时间（原文字留着；重跑时先找没找过的）。
    mimeTriedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type InboxMessagePatch = Static<typeof InboxMessagePatchSchema>;

/**
 * mail.refetch 从 Gmail 重新抓回整封以后原地补的字段（版本加 1，不新建行）：正文两种形式、附件名、原信、位置，以及解析
 * 更准的标题、发件人名字、收件人。发件地址、收到时间、已读 / 收藏 / 归档都不动。
 */
export const InboxMessageRefillSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: INBOX_TITLE_MAX_CHARS }),
    fromName: Nullable(Type.String({ maxLength: 100 })),
    toAddress: Nullable(Type.String({ maxLength: 300 })),
    body: Type.String({ maxLength: INBOX_BODY_MAX_CHARS }),
    attachments: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: INBOX_ATTACHMENTS_MAX }),
    ...MAIL_BODY_FIELDS,
  },
  STRICT,
);
export type InboxMessageRefill = Static<typeof InboxMessageRefillSchema>;

/** 一封邮件的一个内嵌图分段（HTML 里写成 cid:<contentId>），文件在状态目录下。 */
export const InboxMailPartSchema = Type.Object({
  id: IdSchema,
  messageId: IdSchema,
  contentId: Type.String({ minLength: 1, maxLength: 300 }),
  filename: Nullable(Type.String({ maxLength: 200 })),
  type: Type.String({ minLength: 1, maxLength: 100 }),
  size: Type.Integer({ minimum: 0 }),
  path: Type.String({ minLength: 1, maxLength: INBOX_FILE_PATH_MAX_CHARS }),
  createdAt: IsoTimeSchema,
});
export type InboxMailPart = Static<typeof InboxMailPartSchema>;
export const InboxMessageSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(InboxMessageInputSchema).properties,
  ...Type.Required(InboxMessagePatchSchema).properties,
});
export type InboxMessage = Static<typeof InboxMessageSchema>;

/**
 * 一条回复。邮件的回复经邮件发出（开发期干跑，只记不发，10-26 第 8 条）；别的来源没有外发的去处，只留在这里。
 * action_id 是回执的主键：同一次回复重放不发第二封。
 */
export const INBOX_REPLY_STATUSES = ['stored', 'sending', 'sent', 'dry_run', 'failed', 'unknown'] as const;
export const INBOX_REPLY_MAX_CHARS = 8_000;
export const InboxReplySchema = Type.Object({
  ...RECORD_META,
  messageId: IdSchema,
  text: Type.String({ minLength: 1, maxLength: INBOX_REPLY_MAX_CHARS }),
  status: Type.Enum(INBOX_REPLY_STATUSES),
  actionId: Type.String({ minLength: 1 }),
  deviceId: Nullable(IdSchema),
  sentAt: Nullable(IsoTimeSchema),
  // 只存错误的类别和一句话，不存服务器回的原文（可能带账号）。
  error: Nullable(Type.String({ maxLength: 300 })),
});
export type InboxReply = Static<typeof InboxReplySchema>;

/** 收信（IMAP 只读）同步到哪了：一行。错误只记类别和一句话。 */
export const InboxSyncSchema = Type.Object({
  ...RECORD_META,
  uidValidity: Nullable(Type.Integer({ minimum: 0 })),
  lastUid: Nullable(Type.Integer({ minimum: 0 })),
  lastSyncAt: Nullable(IsoTimeSchema),
  lastCount: Nullable(Type.Integer({ minimum: 0 })),
  lastError: Nullable(Type.String({ maxLength: 300 })),
});
export type InboxSync = Static<typeof InboxSyncSchema>;
export const InboxSyncPatchSchema = Type.Partial(
  Type.Object({
    uidValidity: Nullable(Type.Integer({ minimum: 0 })),
    lastUid: Nullable(Type.Integer({ minimum: 0 })),
    lastSyncAt: Nullable(IsoTimeSchema),
    lastCount: Nullable(Type.Integer({ minimum: 0 })),
    lastError: Nullable(Type.String({ maxLength: 300 })),
  }),
  STRICT,
);
export type InboxSyncPatch = Static<typeof InboxSyncPatchSchema>;

// ---------- 工具组 ----------

// 2026-11-05 自迭代、提醒、产出随功能删掉，它们的工具组（self_code、life、artifacts）也删了（迁移 0062 删掉存着的开关）。
export const TOOL_GROUP_IDS = ['cloud_ssh', 'cloud_browser', 'inbox', 'attachments'] as const;
export type ToolGroupId = (typeof TOOL_GROUP_IDS)[number];
export const ToolGroupSchema = Type.Object({
  id: Type.Enum(TOOL_GROUP_IDS),
  enabled: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
  updatedAt: IsoTimeSchema,
  ...CONFIRMATION_META,
});
export type ToolGroup = Static<typeof ToolGroupSchema>;
