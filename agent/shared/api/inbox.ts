// /v2/inbox: 站内信（铃，《UI 方案》第 9 节）。十个分类（全部 · 未读 · 六种来源 · 收藏 · 归档）、已读 / 收藏 / 归档、全部
// 标已读、打开一封看全文和回复、回复。回复邮件经发信发回给发信人（开发期干跑只记不发）；回执不确定的回复是 unknown，
// 用 settle 说发没发出去。铃上的数 = 没读的（不含归档）。信是外部资料：界面照原样显示，不渲染里面的 HTML。

import { Type, type Static } from 'typebox';
import { INBOX_REPLY_MAX_CHARS, INBOX_REPLY_STATUSES, INBOX_SOURCES } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { NextOffsetSchema, OrNull, PageLimitSchema } from './lineage.ts';

export const INBOX_PATH = `${API_PREFIX}/inbox`;
export const INBOX_READ_ALL_PATH = `${INBOX_PATH}/read-all`;
export const INBOX_REPLIES_PATH = `${INBOX_PATH}/replies`;
/** 一页 50 封（1ca0391 inbox.ts）。 */
export const INBOX_PAGE_DEFAULT_LIMIT = 50;

export const INBOX_BOXES = ['all', 'unread', ...INBOX_SOURCES, 'starred', 'archived'] as const;
export type InboxBoxId = (typeof INBOX_BOXES)[number];
export const INBOX_BOX_LABELS: Readonly<Record<InboxBoxId, string>> = {
  all: '全部',
  unread: '未读',
  email: '邮件',
  feedback: '反馈',
  patrol: '巡查建议',
  plasticine: 'Plasticine',
  'cyber-hunter': 'Cyber Hunter',
  interview: '采访',
  starred: '收藏',
  archived: '归档',
};

export const InboxRowViewSchema = Type.Object({
  id: IdSchema,
  source: Type.Enum(INBOX_SOURCES),
  sourceLabel: Type.String(),
  fromAddress: Type.String(),
  fromName: OrNull(Type.String()),
  title: Type.String(),
  preview: Type.String(),
  receivedAt: IsoTimeSchema,
  read: Type.Boolean(),
  starred: Type.Boolean(),
  archived: Type.Boolean(),
  act: Type.Boolean(),
  attachments: Type.Array(Type.String()),
  migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type InboxRowView = Static<typeof InboxRowViewSchema>;

export const InboxUnreadSchema = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  bySource: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
});
export type InboxUnread = Static<typeof InboxUnreadSchema>;

export const InboxSyncViewSchema = Type.Object({
  configured: Type.Boolean(),
  lastSyncAt: OrNull(IsoTimeSchema),
  lastCount: OrNull(Type.Integer({ minimum: 0 })),
  lastError: OrNull(Type.String()),
});
export type InboxSyncView = Static<typeof InboxSyncViewSchema>;

export const SyncInboxRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type SyncInboxRequest = Static<typeof SyncInboxRequestSchema>;
export const SyncInboxResponseSchema = Type.Object({ added: Type.Integer({ minimum: 0 }), sync: InboxSyncViewSchema });
export type SyncInboxResponse = Static<typeof SyncInboxResponseSchema>;
export const InboxFeedbackRequestSchema = Type.Object({ requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: 10000 }) }, { additionalProperties: false });
export type InboxFeedbackRequest = Static<typeof InboxFeedbackRequestSchema>;

/** GET /v2/inbox?box=&q=&offset=&limit= */
export const InboxListQuerySchema = Type.Object(
  {
    box: Type.Optional(Type.Enum(INBOX_BOXES)),
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(PageLimitSchema),
  },
  { additionalProperties: false },
);
export type InboxListQuery = Static<typeof InboxListQuerySchema>;
export const InboxListResponseSchema = Type.Object({
  messages: Type.Array(InboxRowViewSchema),
  total: Type.Integer({ minimum: 0 }),
  nextOffset: NextOffsetSchema,
  unread: InboxUnreadSchema,
  sync: InboxSyncViewSchema,
});
export type InboxListResponse = Static<typeof InboxListResponseSchema>;

export const InboxReplyViewSchema = Type.Object({
  id: IdSchema,
  text: Type.String(),
  status: Type.Enum(INBOX_REPLY_STATUSES),
  statusLabel: Type.String(),
  createdAt: IsoTimeSchema,
  sentAt: OrNull(IsoTimeSchema),
  error: OrNull(Type.String()),
  version: Type.Integer({ minimum: 1 }),
});
export type InboxReplyView = Static<typeof InboxReplyViewSchema>;

/** GET /v2/inbox/:id — 全文和回复。 */
export const InboxMessageViewSchema = Type.Object({
  ...InboxRowViewSchema.properties,
  body: Type.String(),
  toAddress: OrNull(Type.String()),
  replies: Type.Array(InboxReplyViewSchema),
  /** 邮件可以经发信回复；别的来源的回复只记在这里。 */
  replySends: Type.Boolean(),
});
export type InboxMessageView = Static<typeof InboxMessageViewSchema>;

/** POST /v2/inbox/:id/flags → 200 { message }：已读 / 收藏 / 归档，没给的照旧。 */
export const SetInboxFlagsRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    read: Type.Optional(Type.Boolean()),
    starred: Type.Optional(Type.Boolean()),
    archived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 3 },
);
export type SetInboxFlagsRequest = Static<typeof SetInboxFlagsRequestSchema>;
export const InboxRowResponseSchema = Type.Object({ message: InboxRowViewSchema, unread: InboxUnreadSchema });
export type InboxRowResponse = Static<typeof InboxRowResponseSchema>;

/** POST /v2/inbox/read-all → 200 { changed, unread }：这一类里没读的都标成已读。 */
export const ReadAllInboxRequestSchema = Type.Object(
  { requestId: RequestIdSchema, box: Type.Enum(INBOX_BOXES) },
  { additionalProperties: false },
);
export type ReadAllInboxRequest = Static<typeof ReadAllInboxRequestSchema>;
export const ReadAllInboxResponseSchema = Type.Object({
  changed: Type.Integer({ minimum: 0 }),
  unread: InboxUnreadSchema,
});
export type ReadAllInboxResponse = Static<typeof ReadAllInboxResponseSchema>;

/** POST /v2/inbox/:id/replies → 201 { reply }：同一个 requestId 重发拿回同一条，不发第二封。 */
export const ReplyInboxRequestSchema = Type.Object(
  { requestId: RequestIdSchema, text: Type.String({ minLength: 1, maxLength: INBOX_REPLY_MAX_CHARS }) },
  { additionalProperties: false },
);
export type ReplyInboxRequest = Static<typeof ReplyInboxRequestSchema>;
export const InboxReplyResponseSchema = Type.Object({ reply: InboxReplyViewSchema });
export type InboxReplyResponse = Static<typeof InboxReplyResponseSchema>;

/** POST /v2/inbox/replies/:id/settle → 200 { reply }：结果待核实的回复，你说发没发出去。 */
export const SettleInboxReplyRequestSchema = Type.Object(
  { requestId: RequestIdSchema, happened: Type.Boolean() },
  { additionalProperties: false },
);
export type SettleInboxReplyRequest = Static<typeof SettleInboxReplyRequestSchema>;
