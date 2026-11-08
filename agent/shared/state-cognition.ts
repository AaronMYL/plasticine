// M3: what the brain notices about its own understanding, and old rows that have no new object of their own.
// - 分歧标记（≠）：脑发现自己的理解和某条判断 / 约定 / 记忆不一致时记下两边——用户的立场与依据、它的立场与依据、
//   什么会改变各自的看法（《从零方案》第 4、5 节「分歧」）。标记只记两边，不改被标的对象，更不碰用户确认字段。
// - 旧行存档：迁移里没有对应新对象的旧行（旧版的卡、抽取批次、维护索引）整行原样存一份，迁移校验逐条对照。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';
import { DisagreementSchema } from './state-objects.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

export const DISAGREEMENT_TARGETS = ['judgment', 'agreement', 'memory_entry'] as const;
export type DisagreementTarget = (typeof DISAGREEMENT_TARGETS)[number];

// Where a basis can point. `web` keeps origin and path only (state/disagreements.ts strips the rest).
export const BASIS_KINDS = [
  'message',
  'note',
  'evidence',
  'memory_entry',
  'agreement',
  'judgment',
  'run',
  'web',
] as const;
// A quote long enough for two sentences of the original; the original itself stays where `ref` points.
export const BASIS_QUOTE_MAX_CHARS = 500;
// One side rarely rests on more than a handful of things; more is a dump, not a basis.
export const BASIS_REFS_MAX = 10;

export const BasisRefSchema = Type.Object(
  {
    kind: Type.Enum(BASIS_KINDS),
    ref: Text,
    quote: Type.Optional(Type.String({ maxLength: BASIS_QUOTE_MAX_CHARS })),
  },
  STRICT,
);
export type BasisRef = Static<typeof BasisRefSchema>;
const BasisRefs = Type.Array(BasisRefSchema, { maxItems: BASIS_REFS_MAX });

export const DISAGREEMENT_STATUSES = ['open', 'resolved'] as const;

export const DisagreementMarkInputSchema = Type.Object(
  {
    targetType: Type.Enum(DISAGREEMENT_TARGETS),
    targetId: IdSchema,
    /**
     * The version of the marked object the brain was looking at (its context shows it). Kept as given even when the
     * object has changed since, so the view can say the mark was made against an older version.
     */
    targetVersion: Type.Integer({ minimum: 1 }),
    ...DisagreementSchema.properties,
    userSources: BasisRefs,
    brainSources: BasisRefs,
    /** The turn that marked it and the receipt's action id: a replayed call finds its mark instead of adding one. */
    runId: Nullable(IdSchema),
    actionId: Nullable(IdSchema),
  },
  STRICT,
);
export type DisagreementMarkInput = Static<typeof DisagreementMarkInputSchema>;

export const DisagreementMarkPatchSchema = Type.Partial(
  Type.Object({
    ...DisagreementSchema.properties,
    userSources: BasisRefs,
    brainSources: BasisRefs,
    targetVersion: Type.Integer({ minimum: 1 }),
    runId: Nullable(IdSchema),
    actionId: Nullable(IdSchema),
    status: Type.Enum(DISAGREEMENT_STATUSES),
    resolvedAt: Nullable(IsoTimeSchema),
    resolution: Nullable(Type.String()),
    proposedChange: Nullable(Type.String()),
  }),
  STRICT,
);
export type DisagreementMarkPatch = Static<typeof DisagreementMarkPatchSchema>;

export const DisagreementMarkSchema = Type.Object({
  ...RECORD_META,
  ...DisagreementMarkInputSchema.properties,
  status: Type.Enum(DISAGREEMENT_STATUSES),
  resolvedAt: Nullable(IsoTimeSchema),
  resolution: Nullable(Type.String()),
  proposedChange: Type.Optional(Nullable(Type.String())),
});
export type DisagreementMark = Static<typeof DisagreementMarkSchema>;

/** An old row archived whole. `targetTable` / `targetId`: the new object it belongs to, when there is one. */
export const LegacyRowInputSchema = Type.Object(
  {
    sourceDb: Text,
    sourceTable: Text,
    legacyId: Text,
    targetTable: Nullable(Text),
    targetId: Nullable(IdSchema),
    payload: Type.Unknown(),
    reason: Text,
  },
  STRICT,
);
export type LegacyRowInput = Static<typeof LegacyRowInputSchema>;
export const LegacyRowSchema = Type.Object({ ...LegacyRowInputSchema.properties, createdAt: IsoTimeSchema });
export type LegacyRow = Static<typeof LegacyRowSchema>;
