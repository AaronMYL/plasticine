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
import { IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { NextOffsetSchema, OrNull, PageLimitSchema, ReasonTextSchema } from './lineage.ts';
import { MEMORY_PATH } from './memory.ts';

export const MEMORY_DOCS_PATH = `${MEMORY_PATH}/docs`;
export const MEMORY_INFERENCES_PATH = `${MEMORY_PATH}/inferences`;
export const MEMORY_METRIC_DAYS = 30;

export const MemoryDocRowViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_DOC_KINDS),
  title: Type.String(),
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
  excerpt: OrNull(Type.String()),
  at: OrNull(IsoTimeSchema),
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
    lastError: OrNull(Type.String()),
  }),
  metrics: Type.Object({
    since: IsoTimeSchema,
    restated: Type.Integer({ minimum: 0 }),
    usedLines: Type.Integer({ minimum: 0 }),
  }),
});
export type MemoryDocDirectoryResponse = Static<typeof MemoryDocDirectoryResponseSchema>;

/** GET /v2/memory/docs/:id?includeRetired= */
export const MemoryDocQuerySchema = Type.Object(
  { includeRetired: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export const MemoryDocResponseSchema = Type.Object({
  doc: MemoryDocRowViewSchema,
  lines: Type.Array(MemoryLineViewSchema),
  retired: Type.Optional(Type.Array(MemoryLineViewSchema)),
});
export type MemoryDocResponse = Static<typeof MemoryDocResponseSchema>;

export const MemoryInferenceQuerySchema = Type.Object(
  {
    status: Type.Optional(Type.Enum(MEMORY_INFERENCE_STATUSES)),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export const MemoryInferenceListResponseSchema = Type.Object({
  inferences: Type.Array(MemoryInferenceViewSchema),
  nextOffset: NextOffsetSchema,
});
export type MemoryInferenceListResponse = Static<typeof MemoryInferenceListResponseSchema>;

export const DecideMemoryInferenceRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), reason: Type.Optional(ReasonTextSchema) },
  { additionalProperties: false },
);
export const MemoryInferenceResponseSchema = Type.Object({
  inference: MemoryInferenceViewSchema,
  line: OrNull(MemoryLineViewSchema),
});
export type MemoryInferenceResponse = Static<typeof MemoryInferenceResponseSchema>;

export const EditMemoryLineRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
  },
  { additionalProperties: false },
);
export type EditMemoryLineRequest = Static<typeof EditMemoryLineRequestSchema>;

export const RetireMemoryLineRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }),
    mode: Type.Optional(Type.Enum(['forget', 'withdraw'])) },
  { additionalProperties: false },
);
export type RetireMemoryLineRequest = Static<typeof RetireMemoryLineRequestSchema>;

export const MemoryLineResponseSchema = Type.Object({ line: MemoryLineViewSchema });
export type MemoryLineResponse = Static<typeof MemoryLineResponseSchema>;

