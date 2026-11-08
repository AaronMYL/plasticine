// /v2/memory/docs 与 /v2/memory/inferences：记忆文档（用户 2026-11-02 定，docs/specs/memory-docs.md 第 7 节），给下一批的
// 记忆页（主题目录 + 拿不准的）用。读要登录；用户改一行、退休一行要登录和 requestId（行没有用户确认字段，同旧记忆条目）；
// 确认 / 否掉一条推断是用户确认字段，由本人配对会话确认（同约定确认）。
// 写操作按 requestId 幂等、带 version，过时就 409 带当前那一条。

import { Type, type Static } from 'typebox';
import {
  MEMORY_ANCHOR_KINDS,
  MEMORY_DOC_KINDS,
  MEMORY_INFERENCE_STATUSES,
  MEMORY_LINE_BASES,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_LINE_RETIRE_REASONS,
  MEMORY_LINE_SECTIONS,
  ACTORS,
} from '../state.ts';
import { ApiErrorSchema, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { NextOffsetSchema, OrNull, PageLimitSchema, ReasonTextSchema } from './lineage.ts';
import { MEMORY_PATH } from './memory.ts';

export const MEMORY_DOCS_PATH = `${MEMORY_PATH}/docs`;
export const MEMORY_INFERENCES_PATH = `${MEMORY_PATH}/inferences`;
// 目录里两条度量线按最近 30 天算。
export const MEMORY_METRIC_DAYS = 30;

export const MemoryDocRowViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_DOC_KINDS),
  title: Type.String(),
  /** 一句话说明（≤ 150 字）。 */
  summary: Type.String(),
  projectId: OrNull(IdSchema),
  lines: Type.Integer({ minimum: 0 }),
  chars: Type.Integer({ minimum: 0 }),
  charLimit: Type.Integer({ minimum: 1 }),
  pendingInferences: Type.Integer({ minimum: 0 }),
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryDocRowView = Static<typeof MemoryDocRowViewSchema>;

export const MemoryAnchorViewSchema = Type.Object({
  kind: Type.Enum(MEMORY_ANCHOR_KINDS),
  ref: IdSchema,
  /** 原话的开头（消息、旧记忆条目）；笔记可能上了锁，不给摘录。读不到时为 null。 */
  excerpt: OrNull(Type.String()),
  /** 消息的发送时间 / 旧条目的建立时间。 */
  at: OrNull(IsoTimeSchema),
  /** 消息所在的会话，界面跳过去用。 */
  chatId: OrNull(Type.String()),
});
export type MemoryAnchorView = Static<typeof MemoryAnchorViewSchema>;

export const MemoryLineViewSchema = Type.Object({
  id: IdSchema,
  docId: IdSchema,
  section: Type.Enum(MEMORY_LINE_SECTIONS),
  text: Type.String(),
  basis: Type.Enum(MEMORY_LINE_BASES),
  anchors: Type.Array(MemoryAnchorViewSchema),
  /** 「之前：…」；新事为 null。 */
  previous: OrNull(Type.String()),
  supersedes: Type.Array(IdSchema),
  inferenceId: OrNull(IdSchema),
  writtenBy: Type.Enum(ACTORS),
  migrated: Type.Boolean(),
  retiredAt: OrNull(IsoTimeSchema),
  retiredReason: OrNull(Type.Enum(MEMORY_LINE_RETIRE_REASONS)),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryLineView = Static<typeof MemoryLineViewSchema>;

export const MemoryInferenceViewSchema = Type.Object({
  id: IdSchema,
  docId: IdSchema,
  docTitle: Type.String(),
  section: Type.Enum(MEMORY_LINE_SECTIONS),
  text: Type.String(),
  why: Type.String(),
  anchors: Type.Array(MemoryAnchorViewSchema),
  status: Type.Enum(MEMORY_INFERENCE_STATUSES),
  decidedAt: OrNull(IsoTimeSchema),
  lineId: OrNull(IdSchema),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryInferenceView = Static<typeof MemoryInferenceViewSchema>;

/** GET /v2/memory/docs —— 目录、拿不准的条数、迁移进度、整理队列、近 30 天的两条度量线。 */
export const MemoryDocDirectoryResponseSchema = Type.Object({
  docs: Type.Array(MemoryDocRowViewSchema),
  pendingInferences: Type.Integer({ minimum: 0 }),
  migration: Type.Object({
    status: Type.Enum(['not_started', 'running', 'finished']),
    total: Type.Integer({ minimum: 0 }),
    pending: Type.Integer({ minimum: 0 }),
  }),
  curation: Type.Object({
    queued: Type.Integer({ minimum: 0 }),
    running: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    /** 最近一次失败的原因（中文一句），没有失败为 null。 */
    lastError: OrNull(Type.String()),
  }),
  metrics: Type.Object({
    since: IsoTimeSchema,
    /** 用户把已经记住的事又说一遍的次数（越少越好）。 */
    restated: Type.Integer({ minimum: 0 }),
    /** 回复里实际用到的记忆行数（整理模型判断）。 */
    usedLines: Type.Integer({ minimum: 0 }),
  }),
});
export type MemoryDocDirectoryResponse = Static<typeof MemoryDocDirectoryResponseSchema>;

/** GET /v2/memory/docs/:id?includeRetired= */
export const MemoryDocQuerySchema = Type.Object(
  { includeRetired: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type MemoryDocQuery = Static<typeof MemoryDocQuerySchema>;
export const MemoryDocResponseSchema = Type.Object({
  doc: MemoryDocRowViewSchema,
  lines: Type.Array(MemoryLineViewSchema),
  /** 只在 includeRetired 时有：退休的行，最近退休的在前。 */
  retired: Type.Optional(Type.Array(MemoryLineViewSchema)),
});
export type MemoryDocResponse = Static<typeof MemoryDocResponseSchema>;

/** GET /v2/memory/inferences?status=&limit=&offset= —— 默认只看 pending，新的在前。 */
export const MemoryInferenceQuerySchema = Type.Object(
  {
    status: Type.Optional(Type.Enum(MEMORY_INFERENCE_STATUSES)),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type MemoryInferenceQuery = Static<typeof MemoryInferenceQuerySchema>;
export const MemoryInferenceListResponseSchema = Type.Object({
  inferences: Type.Array(MemoryInferenceViewSchema),
  nextOffset: NextOffsetSchema,
});
export type MemoryInferenceListResponse = Static<typeof MemoryInferenceListResponseSchema>;

/**
 * POST /v2/memory/inferences/:id/confirm 和 /reject —— 本人会话确认（同约定确认）。确认后这条推断写成文档里的一行
 * （依据 confirmed_inference）；否掉只记下决定。已经定过的再来一次是 409 conflict。
 */
export const DecideMemoryInferenceRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), reason: Type.Optional(ReasonTextSchema) },
  { additionalProperties: false },
);
export type DecideMemoryInferenceRequest = Static<typeof DecideMemoryInferenceRequestSchema>;
export const MemoryInferenceResponseSchema = Type.Object({
  inference: MemoryInferenceViewSchema,
  /** 确认时写成的那一行；否掉时为 null。 */
  line: OrNull(MemoryLineViewSchema),
});
export type MemoryInferenceResponse = Static<typeof MemoryInferenceResponseSchema>;

/** PUT /v2/memory/docs/:docId/lines/:lineId —— 用户改一行：新行替代旧行，旧文字留作「之前」。 */
export const EditMemoryLineRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
  },
  { additionalProperties: false },
);
export type EditMemoryLineRequest = Static<typeof EditMemoryLineRequestSchema>;

/** POST /v2/memory/docs/:docId/lines/:lineId/retire —— 用户要忘掉这一行：整行退休（软删，行还在）。 */
export const RetireMemoryLineRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type RetireMemoryLineRequest = Static<typeof RetireMemoryLineRequestSchema>;

export const MemoryLineResponseSchema = Type.Object({ line: MemoryLineViewSchema });
export type MemoryLineResponse = Static<typeof MemoryLineResponseSchema>;

/** 409：这一行或这条推断在别处改过 / 已经退休或定过；`current` 是现在的样子。 */
export const MemoryLineConflictSchema = Type.Object({ ...ApiErrorSchema.properties, current: MemoryLineViewSchema });
export type MemoryLineConflict = Static<typeof MemoryLineConflictSchema>;
export const MemoryInferenceConflictSchema = Type.Object({ ...ApiErrorSchema.properties,
  current: MemoryInferenceViewSchema });
export type MemoryInferenceConflict = Static<typeof MemoryInferenceConflictSchema>;
