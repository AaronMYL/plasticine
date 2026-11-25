import { Type, type Static } from 'typebox';
import { CONFIRMATION_META, IdSchema, IsoTimeSchema, Nullable, OBJECT_META, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const INBOX_SOURCES = ['email', 'feedback', 'patrol', 'plasticine', 'cyber-hunter', 'interview'] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];
export const INBOX_TITLE_MAX_CHARS = 200;
export const INBOX_BODY_MAX_CHARS = 40_000;
export const INBOX_ATTACHMENTS_MAX = 30;
export const INBOX_HTML_MAX_CHARS = 2_000_000;
export const INBOX_FILE_PATH_MAX_CHARS = 300;

const MAIL_BODY_FIELDS = {
  bodyHtml: Nullable(Type.String({ maxLength: INBOX_HTML_MAX_CHARS })),
  rawPath: Nullable(Type.String({ minLength: 1, maxLength: INBOX_FILE_PATH_MAX_CHARS })),
  rawSha256: Nullable(Type.String({ pattern: '^[0-9a-f]{64}$' })),
  imapUid: Nullable(Type.Integer({ minimum: 1 })),
  uidValidity: Nullable(Type.Integer({ minimum: 1 })),
  mailbox: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
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
    act: Type.Optional(Type.Boolean()),
    attachments: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: INBOX_ATTACHMENTS_MAX }),
    ),
    messageId: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 300 }))),
    toAddress: Type.Optional(Nullable(Type.String({ maxLength: 300 }))),
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
    duplicateOf: Nullable(IdSchema),
    mimeTriedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type InboxMessagePatch = Static<typeof InboxMessagePatchSchema>;

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
  error: Nullable(Type.String({ maxLength: 300 })),
});
export type InboxReply = Static<typeof InboxReplySchema>;

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
