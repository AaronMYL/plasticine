import { Type, type Static } from 'typebox';
import {
  ActorSchema,
  CONFIRMATION_META,
  IdSchema,
  IsoTimeSchema,
  Nullable,
  OBJECT_META,
  RECORD_META,
} from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

export const MEMORY_DOC_KINDS = ['you', 'rules', 'person', 'project', 'topic', 'skill', 'how', 'grants',
  'proactive'] as const;
export const MEMORY_NEW_DOC_KINDS = ['person', 'topic', 'skill', 'how'] as const;
export type MemoryNewDocKind = (typeof MEMORY_NEW_DOC_KINDS)[number];
export type MemoryDocKind = (typeof MEMORY_DOC_KINDS)[number];
export const YOU_DOC_ID = 'memdoc-you';
export const YOU_DOC_TITLE = '关于你';
export const RULES_DOC_ID = 'memdoc-rules';
export const RULES_DOC_TITLE = '规则';
export const GRANTS_DOC_ID = 'memdoc-grants';
export const GRANTS_DOC_TITLE = '承诺和授权';
export const PROACTIVE_DOC_ID = 'memdoc-proactive';
export const PROACTIVE_DOC_TITLE = '主动告诉你';
export function projectDocId(projectId: string): string {
  return `memdoc-project-${projectId}`;
}

export const MEMORY_DOC_SUMMARY_MAX_CHARS = 150;
export const MEMORY_DOC_TITLE_MAX_CHARS = 60;
export const MEMORY_LINE_MAX_CHARS = 500;
export const MEMORY_DOC_CHAR_LIMIT = 4_000;
export const MEMORY_DOC_COMPACT_RATIO = 0.85;

export const MEMORY_LINE_SECTIONS = ['note', 'decision', 'allow', 'ask', 'hold', 'promise', 'never', 'when', 'style',
  'do', 'avoid'] as const;
export type MemoryLineSection = (typeof MEMORY_LINE_SECTIONS)[number];
const NOTE_ONLY: readonly MemoryLineSection[] = ['note'];
const KIND_SECTIONS: Readonly<Partial<Record<MemoryDocKind, readonly MemoryLineSection[]>>> = {
  project: ['note', 'decision'],
  grants: ['allow', 'ask', 'hold', 'promise'],
  proactive: ['never', 'when', 'style'],
  how: ['do', 'avoid'],
};
export function memorySectionsOf(kind: MemoryDocKind): readonly MemoryLineSection[] {
  return KIND_SECTIONS[kind] ?? NOTE_ONLY;
}
export function memorySectionIn(kind: MemoryDocKind, section: MemoryLineSection): MemoryLineSection {
  const allowed = memorySectionsOf(kind);
  return allowed.includes(section) ? section : allowed[0] ?? 'note';
}
export const MEMORY_SECTION_LABELS: Readonly<Record<MemoryLineSection, string>> = {
  note: '记下的', decision: '决定', allow: '可以直接做', ask: '先问你', hold: '先停着', promise: '答应你的',
  never: '别提的', when: '什么时候', style: '怎么通知', do: '做法', avoid: '要避开的',
};
export const MEMORY_LINE_BASES = ['stated', 'confirmed_inference', 'system', 'contact_stated', 'tried'] as const;
export type MemoryLineBasis = (typeof MEMORY_LINE_BASES)[number];
export const MEMORY_LINE_RETIRE_REASONS = ['revised', 'merged', 'forgotten', 'edited', 'no_longer_true'] as const;
export type MemoryLineRetireReason = (typeof MEMORY_LINE_RETIRE_REASONS)[number];

export const MEMORY_ANCHOR_KINDS = [
  'message', 'note', 'memory_entry', 'user_edit', 'agreement', 'term', 'system',
  'mate',
  'contact_message',
  'work',
] as const;

export const MEMORY_SCOPE_KINDS = ['all', 'mate', 'project', 'contact'] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];
export const MemoryAnchorSchema = Type.Object({ kind: Type.Enum(MEMORY_ANCHOR_KINDS), ref: IdSchema }, STRICT);
export type MemoryAnchor = Static<typeof MemoryAnchorSchema>;
const Anchors = Type.Array(MemoryAnchorSchema, { minItems: 1 });

export const MemoryDocInputSchema = Type.Object(
  {
    kind: Type.Enum(MEMORY_DOC_KINDS),
    title: Type.String({ minLength: 1, maxLength: MEMORY_DOC_TITLE_MAX_CHARS }),
    summary: Type.String({ maxLength: MEMORY_DOC_SUMMARY_MAX_CHARS }),
    projectId: Type.Optional(Nullable(IdSchema)),
    charLimit: Type.Optional(Type.Integer({ minimum: 200, maximum: 50_000 })),
    createdBy: ActorSchema,
    retiredAt: Type.Optional(Nullable(IsoTimeSchema)),
  },
  STRICT,
);
export type MemoryDocInput = Static<typeof MemoryDocInputSchema>;
export const MemoryDocPatchSchema = Type.Partial(
  Type.Object({
    title: MemoryDocInputSchema.properties.title,
    summary: MemoryDocInputSchema.properties.summary,
    charLimit: Type.Integer({ minimum: 200, maximum: 50_000 }),
    retiredAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export const MemoryDocSchema = Type.Object({ ...OBJECT_META, ...Type.Required(MemoryDocInputSchema).properties });
export type MemoryDoc = Static<typeof MemoryDocSchema>;

export const MemoryLineInputSchema = Type.Object(
  {
    docId: IdSchema,
    section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    basis: Type.Enum(MEMORY_LINE_BASES),
    anchors: Anchors,
    previous: Type.Optional(Nullable(Type.String())),
    supersedes: Type.Optional(Type.Array(IdSchema)),
    inferenceId: Type.Optional(Nullable(IdSchema)),
    position: Type.Optional(Type.Integer({ minimum: 0 })),
    writtenBy: ActorSchema,
    writtenRef: Type.Optional(Nullable(Type.String())),
    scopeKind: Type.Optional(Type.Enum(MEMORY_SCOPE_KINDS)),
    scopeRef: Type.Optional(Nullable(IdSchema)),
  },
  STRICT,
);
export type MemoryLineInput = Static<typeof MemoryLineInputSchema>;
export const MemoryLinePatchSchema = Type.Partial(Type.Object({
  scopeKind: Type.Enum(MEMORY_SCOPE_KINDS),
  scopeRef: Nullable(IdSchema),
  retiredAt: IsoTimeSchema,
  retiredReason: Type.Enum(MEMORY_LINE_RETIRE_REASONS),
  archivedAt: IsoTimeSchema,
  deletedAt: IsoTimeSchema,
}), STRICT);
export const MemoryLineSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(MemoryLineInputSchema).properties,
  retiredAt: Nullable(IsoTimeSchema),
  retiredReason: Nullable(Type.Enum(MEMORY_LINE_RETIRE_REASONS)),
  archivedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type MemoryLine = Static<typeof MemoryLineSchema>;
export const FORGOTTEN_TEXT = '（已忘掉）';

export function archivesOnRetire(reason: MemoryLineRetireReason): boolean {
  return reason !== 'forgotten';
}

export const MEMORY_DOC_EVENT_KINDS = [
  'doc_created',
  'doc_summary',
  'line_added',
  'line_revised',
  'line_retired',
  'lines_merged',
  'line_edited',
  'inference_proposed',
  'inference_confirmed',
  'inference_rejected',
  'inference_withdrawn',
  'inference_moved',
  'restated',
  'lines_used',
  'entries_migrated',
  'lines_forgotten',
] as const;
export type MemoryDocEventKind = (typeof MEMORY_DOC_EVENT_KINDS)[number];
export const MemoryDocEventInputSchema = Type.Object(
  {
    docId: Nullable(IdSchema),
    lineId: Nullable(IdSchema),
    kind: Type.Enum(MEMORY_DOC_EVENT_KINDS),
    actor: ActorSchema,
    actorRef: Nullable(Type.String()),
    detail: Type.Record(Type.String(), Type.Unknown()),
  },
  STRICT,
);
export type MemoryDocEventInput = Static<typeof MemoryDocEventInputSchema>;
export const MemoryDocEventSchema = Type.Object({
  ...MemoryDocEventInputSchema.properties,
  id: IdSchema,
  createdAt: IsoTimeSchema,
});
export type MemoryDocEvent = Static<typeof MemoryDocEventSchema>;

export const MEMORY_INFERENCE_STATUSES = ['pending', 'confirmed', 'rejected', 'withdrawn'] as const;
export const MemoryInferenceInputSchema = Type.Object(
  {
    docId: IdSchema,
    section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    why: Type.String({ maxLength: 1_000 }),
    anchors: Anchors,
    jobId: Type.Optional(Nullable(IdSchema)),
    status: Type.Optional(Type.Literal('pending')),
    lineId: Type.Optional(Nullable(IdSchema)),
  },
  STRICT,
);
export type MemoryInferenceInput = Static<typeof MemoryInferenceInputSchema>;
export const MemoryInferencePatchSchema = Type.Partial(
  Type.Object({ lineId: Nullable(IdSchema), docId: IdSchema, status: Type.Literal('withdrawn') }),
  STRICT,
);
export type MemoryInferencePatch = Static<typeof MemoryInferencePatchSchema>;
export const MemoryInferenceConfirmedSchema = Type.Object(
  { status: Type.Enum(['confirmed', 'rejected']), decidedAt: IsoTimeSchema },
  STRICT,
);
export type MemoryInferenceConfirmed = Static<typeof MemoryInferenceConfirmedSchema>;
export const MemoryInferenceSchema = Type.Object({
  ...RECORD_META,
  ...CONFIRMATION_META,
  ...Type.Required(MemoryInferenceInputSchema).properties,
  status: Type.Enum(MEMORY_INFERENCE_STATUSES),
  decidedAt: Nullable(IsoTimeSchema),
});
export type MemoryInference = Static<typeof MemoryInferenceSchema>;

export const MEMORY_JOB_KINDS = ['turn', 'compact', 'migration', 'contact'] as const;
export type MemoryJobKind = (typeof MEMORY_JOB_KINDS)[number];
export const MEMORY_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type MemoryJobStatus = (typeof MEMORY_JOB_STATUSES)[number];
export const MemoryJobInputSchema = Type.Object(
  {
    key: Text,
    kind: Type.Enum(MEMORY_JOB_KINDS),
    runId: Type.Optional(Nullable(IdSchema)),
    chatId: Type.Optional(Nullable(Type.String())),
    replyId: Type.Optional(Nullable(IdSchema)),
    docId: Type.Optional(Nullable(IdSchema)),
    sourceIds: Type.Array(IdSchema),
  },
  STRICT,
);
export type MemoryJobInput = Static<typeof MemoryJobInputSchema>;
export const MemoryJobResultSchema = Type.Object(
  {
    applied: Type.Integer({ minimum: 0 }),
    rejected: Type.Array(Type.Object({ op: Type.String(), reason: Type.String() }, STRICT)),
    note: Type.Optional(Type.String()),
  },
  STRICT,
);
export type MemoryJobResult = Static<typeof MemoryJobResultSchema>;
export const MemoryJobPatchSchema = Type.Partial(
  Type.Object({
    status: Type.Enum(MEMORY_JOB_STATUSES),
    attempts: Type.Integer({ minimum: 0 }),
    error: Nullable(Type.String()),
    result: Nullable(MemoryJobResultSchema),
    startedAt: Nullable(IsoTimeSchema),
    finishedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export const MemoryJobSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(MemoryJobInputSchema).properties,
  ...Type.Required(MemoryJobPatchSchema).properties,
});
export type MemoryJob = Static<typeof MemoryJobSchema>;

export const MemoryMigrationStateSchema = Type.Object(
  { startedAt: IsoTimeSchema, cutoff: IsoTimeSchema, finishedAt: Nullable(IsoTimeSchema) },
  STRICT,
);
export type MemoryMigrationState = Static<typeof MemoryMigrationStateSchema>;

export const MEMORY_ENTRY_MIGRATION_OUTCOMES = ['line', 'inference', 'skipped'] as const;
export const MemoryEntryMigrationSchema = Type.Object(
  {
    entryId: IdSchema,
    jobId: Nullable(IdSchema),
    outcome: Type.Enum(MEMORY_ENTRY_MIGRATION_OUTCOMES),
    targetId: Nullable(IdSchema),
    note: Type.String(),
    createdAt: IsoTimeSchema,
  },
  STRICT,
);
export type MemoryEntryMigration = Static<typeof MemoryEntryMigrationSchema>;

export const MEMORY_CONFLICT_STATUSES = ['open', 'resolved'] as const;
export const MEMORY_CONFLICT_RESOLUTIONS = ['kept', 'both', 'neither'] as const;
export const MemoryConflictInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 60 }),
  lineIds: Type.Array(IdSchema, { minItems: 2, maxItems: 4, uniqueItems: true }),
  foundBy: Type.Optional(Nullable(Type.String())),
}, STRICT);
export const MemoryConflictSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  title: Type.String(),
  lineIds: Type.Array(IdSchema),
  status: Type.Enum(MEMORY_CONFLICT_STATUSES),
  resolution: Nullable(Type.Enum(MEMORY_CONFLICT_RESOLUTIONS)),
  keptLineIds: Type.Array(IdSchema),
  foundBy: Nullable(Type.String()),
  resolvedAt: Nullable(IsoTimeSchema),
}, STRICT);
export type MemoryConflict = Static<typeof MemoryConflictSchema>;
export const MemoryConflictPatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(MEMORY_CONFLICT_STATUSES),
  resolution: Nullable(Type.Enum(MEMORY_CONFLICT_RESOLUTIONS)),
  keptLineIds: Type.Array(IdSchema),
  resolvedAt: Nullable(IsoTimeSchema),
}), STRICT);

export const MEMORY_CLEANUP_STATUSES = ['running', 'ready', 'failed', 'done'] as const;
export const MEMORY_CLEANUP_ITEM_KINDS = ['merge', 'move', 'archive', 'rewrite', 'add'] as const;
export const MemoryCleanupItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40 }),
  kind: Type.Enum(MEMORY_CLEANUP_ITEM_KINDS),
  lineIds: Type.Array(IdSchema, { maxItems: 8 }),
  toDocId: Nullable(IdSchema),
  text: Nullable(Type.String({ minLength: 1, maxLength: 600 })),
  reason: Type.String({ maxLength: 200 }),
  origin: Type.Enum(['model', 'claude']),
  applied: Nullable(Type.Boolean()),
}, STRICT);
export type MemoryCleanupItem = Static<typeof MemoryCleanupItemSchema>;
export const MemoryCleanupSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  status: Type.Enum(MEMORY_CLEANUP_STATUSES),
  error: Nullable(Type.String()),
  overview: Nullable(Type.String({ maxLength: 800 })),
  items: Type.Array(MemoryCleanupItemSchema, { maxItems: 400 }),
  finishedAt: Nullable(IsoTimeSchema),
}, STRICT);
export type MemoryCleanup = Static<typeof MemoryCleanupSchema>;
export const MemoryCleanupPatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(MEMORY_CLEANUP_STATUSES),
  error: Nullable(Type.String()),
  overview: Nullable(Type.String({ maxLength: 800 })),
  items: Type.Array(MemoryCleanupItemSchema, { maxItems: 400 }),
  finishedAt: Nullable(IsoTimeSchema),
}), STRICT);
