// 记忆文档（用户 2026-11-02 定，docs/specs/memory-docs.md）：记忆按主题整理成活文档——关于你 / 人 / 项目 / 话题，
// 一个主题一份。每一行链回用户原话；变了就由新行替代旧行（旧行退休、新行存「之前」），不往后堆；
// Plasticine 自己推出来的先进「拿不准的」（memory_inferences），用户在设备上确认了才写成行。
// Import from shared/state.ts.

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

// rules：「怎么替你做事」（《置信度与做事方式改动方案》第 4 批，11-04 用户定）——和「关于你」并列，只有一份：
// 「关于你」记用户是谁，这份记用户要 Plasticine 怎么做事。两份每次都整份进上下文。
// skill：技能（《优化清单》第 16 条，11-06 定）——做成过一次的做法，一个技能一篇。
export const MEMORY_DOC_KINDS = ['you', 'rules', 'person', 'project', 'topic', 'skill'] as const;
/** 模型能新建的种类：关于你、怎么替你做事各只有一份，项目文档只由项目生成。 */
export const MEMORY_NEW_DOC_KINDS = ['person', 'topic', 'skill'] as const;
export type MemoryNewDocKind = (typeof MEMORY_NEW_DOC_KINDS)[number];
export type MemoryDocKind = (typeof MEMORY_DOC_KINDS)[number];
/** 「关于你」只有一份，标识固定。 */
export const YOU_DOC_ID = 'memdoc-you';
export const YOU_DOC_TITLE = '关于你';
/** 「怎么替你做事」只有一份，标识固定。 */
export const RULES_DOC_ID = 'memdoc-rules';
export const RULES_DOC_TITLE = '规则';
/** 项目文档和项目一一对应，标识由项目标识推出。 */
export function projectDocId(projectId: string): string {
  return `memdoc-project-${projectId}`;
}

// 一句话说明：参照 Claude 自己的记忆口径，写清讲谁、哪些项目 / 地点 / 事，150 字以内。
export const MEMORY_DOC_SUMMARY_MAX_CHARS = 150;
export const MEMORY_DOC_TITLE_MAX_CHARS = 60;
// 一行讲一件事；500 字放得下一段原话的要点，再长就该拆成两行。
export const MEMORY_LINE_MAX_CHARS = 500;
// 一份文档在用的文字上限，约一页（4 000 字）；在用文字到 85% 时排一次合并压缩。
export const MEMORY_DOC_CHAR_LIMIT = 4_000;
export const MEMORY_DOC_COMPACT_RATIO = 0.85;

/** 决定段只在项目文档里（项目档案的「决定」）；其余都是 note。 */
export const MEMORY_LINE_SECTIONS = ['note', 'decision'] as const;
export type MemoryLineSection = (typeof MEMORY_LINE_SECTIONS)[number];
/** stated = 用户说的；confirmed_inference = 用户确认过的推断；system = 产品默认规则。 */
export const MEMORY_LINE_BASES = ['stated', 'confirmed_inference', 'system'] as const;
export type MemoryLineBasis = (typeof MEMORY_LINE_BASES)[number];
/** 行退休的原因：被新行替代、合并压缩、用户要忘掉、用户改写、用户说不再成立。 */
export const MEMORY_LINE_RETIRE_REASONS = ['revised', 'merged', 'forgotten', 'edited', 'no_longer_true'] as const;
export type MemoryLineRetireReason = (typeof MEMORY_LINE_RETIRE_REASONS)[number];

/**
 * 一行链回哪里：用户消息、笔记、迁移来的旧记忆条目（它再链到消息或笔记）、用户在记忆页的一次改写（记忆文档事件），
 * 或一条约定（第 4 批：在用的约定整理进「怎么替你做事」，每行指回原来那条约定；约定表本身不动），
 * 或一条词表（2026-11-05：词表并进「怎么替你做事」，每行指回原来那条词表条目；词表本身不动、不删）。
 */
export const MEMORY_ANCHOR_KINDS = [
  'message', 'note', 'memory_entry', 'user_edit', 'agreement', 'term', 'system',
  // 11-11：队友原来那段自由文字的 Soul 拆成的规则，ref 是队友 id（来源写「队友设定」）。
  'mate',
] as const;

/**
 * 适用范围（11-11 第 11 批第二步）：all 全部；mate 只对某位队友（ref = 队友 id）；project 某个项目（ref = 项目 id）；
 * contact 某个联系人（ref = 联系人 id）。项目文档、人物文档的行范围跟着文档走，存的仍是 all。
 */
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
export type MemoryDocPatch = Static<typeof MemoryDocPatchSchema>;
export const MemoryDocSchema = Type.Object({ ...OBJECT_META, ...Type.Required(MemoryDocInputSchema).properties });
export type MemoryDoc = Static<typeof MemoryDocSchema>;

export const MemoryLineInputSchema = Type.Object(
  {
    docId: IdSchema,
    section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    basis: Type.Enum(MEMORY_LINE_BASES),
    anchors: Anchors,
    /** 被替代那一行的文字（界面显示「之前：…」）；新事就是 null。 */
    previous: Type.Optional(Nullable(Type.String())),
    /** 替代了哪几行（改一行是一个，合并是几个）。 */
    supersedes: Type.Optional(Type.Array(IdSchema)),
    /** confirmed_inference 行由哪一条确认过的推断写成。 */
    inferenceId: Type.Optional(Nullable(IdSchema)),
    /** 文档里的次序：改出来的新行接旧行的位置，所以「改那一行」不往后堆。 */
    position: Type.Optional(Type.Integer({ minimum: 0 })),
    writtenBy: ActorSchema,
    writtenRef: Type.Optional(Nullable(Type.String())),
    scopeKind: Type.Optional(Type.Enum(MEMORY_SCOPE_KINDS)),
    scopeRef: Type.Optional(Nullable(IdSchema)),
  },
  STRICT,
);
export type MemoryLineInput = Static<typeof MemoryLineInputSchema>;
/**
 * 行只在退休、归档、删除时改：其余内容不原地改写（改 = 新行替代）。三层（第 16 条）：现行（没退休）→ 归档（被取代的旧说法、
 * 过时的事实，archivedAt；不给模型看，问「以前怎么定的」能搜到，永久留着）→ 删除（他说「忘掉」，deletedAt；哪里都不再出现）。
 */
export const MemoryLinePatchSchema = Type.Partial(Type.Object({
  /** 范围不是内容：改范围原地改，事件里记一笔（11-11）。 */
  scopeKind: Type.Enum(MEMORY_SCOPE_KINDS),
  scopeRef: Nullable(IdSchema),
  retiredAt: IsoTimeSchema,
  retiredReason: Type.Enum(MEMORY_LINE_RETIRE_REASONS),
  archivedAt: IsoTimeSchema,
  deletedAt: IsoTimeSchema,
}), STRICT);
export type MemoryLinePatch = Static<typeof MemoryLinePatchSchema>;
export const MemoryLineSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(MemoryLineInputSchema).properties,
  retiredAt: Nullable(IsoTimeSchema),
  retiredReason: Nullable(Type.Enum(MEMORY_LINE_RETIRE_REASONS)),
  archivedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type MemoryLine = Static<typeof MemoryLineSchema>;
/**
 * 他说「忘掉」的行从库里删掉以后（11-07 他定「删除」真的抹掉），还得留着的那条记录（昨晚整理的一条变更、确认过的推断）
 * 原文换成这一句：记录还在，讲的是什么不再留。
 */
export const FORGOTTEN_TEXT = '（已忘掉）';

/** 退休的原因里哪些进归档；forgotten（他要忘掉）是删除，不进归档。 */
export function archivesOnRetire(reason: MemoryLineRetireReason): boolean {
  return reason !== 'forgotten';
}

/** 只追加的记忆文档事件；restated 和 lines_used 是两条度量线的原始记录。 */
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
  // 系统撤回一条还没定的推断（重复、错了或被新的一条替代），或把它挪到更贴切的文档；都不是用户的决定。
  'inference_withdrawn',
  'inference_moved',
  'restated',
  'lines_used',
  'entries_migrated',
  // 第 16 条：他说「忘掉」，现行和归档里的行一起删（删前出卡确认过）。
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

// 拿不准的：Plasticine 推出来的事。status 和 decidedAt 是用户确认字段（同约定生效、p）：普通写入只能写 pending，
// 外加 withdrawn——系统依第 99 条④撤回自己还没让用户定的提议（重复的、错的、被新一条替代的），
// decidedAt 和设备确认仍为空，所以撤回不会被当成用户否掉。confirmed / rejected 只经设备确认写入。
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
/** 普通写入能改的：确认后连回写成的行；还没定的推断可以挪到另一份文档、由系统撤回（state 层只许 pending 的这样改）。 */
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

// 后台整理的作业：turn = 一个对话轮之后；compact = 一份文档快满了；migration = 旧条目一次性整理的一批。
export const MEMORY_JOB_KINDS = ['turn', 'compact', 'migration'] as const;
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
    /** turn：这一轮真实的用户消息；migration：这一批的旧条目。 */
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
export type MemoryJobPatch = Static<typeof MemoryJobPatchSchema>;
export const MemoryJobSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(MemoryJobInputSchema).properties,
  ...Type.Required(MemoryJobPatchSchema).properties,
});
export type MemoryJob = Static<typeof MemoryJobSchema>;

/** 一次性迁移的进度：截止点之前建的旧条目都有了去向，就记完成时间。 */
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

/** 说法冲突（11-11）：每晚整理时找出的两条（或几条）互相矛盾的现行行，Aaron 选以哪条为准。 */
export const MEMORY_CONFLICT_STATUSES = ['open', 'resolved'] as const;
/** kept：留下其中一条（其余退休）；both：都留（通常接着改范围）；neither：都不要了。 */
export const MEMORY_CONFLICT_RESOLUTIONS = ['kept', 'both', 'neither'] as const;
export type MemoryConflictResolution = (typeof MEMORY_CONFLICT_RESOLUTIONS)[number];
export const MemoryConflictInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 60 }),
  lineIds: Type.Array(IdSchema, { minItems: 2, maxItems: 4, uniqueItems: true }),
  foundBy: Type.Optional(Nullable(Type.String())),
}, STRICT);
export type MemoryConflictInput = Static<typeof MemoryConflictInputSchema>;
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
export type MemoryConflictPatch = Static<typeof MemoryConflictPatchSchema>;
