// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { CONFIRMATION_META, IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });
const IdList = Type.Array(IdSchema);
const Probability = Type.Number({ minimum: 0, maximum: 1 });

export const SOURCE_WEIGHTS = {
  reality_outcome: 1,
  user_said: 1,
  user_confirmed: 1,
  independent_statement: 0.5,
  verifiable_original: 0.5,
  own_reasoning: 0.1,
  ai_conversation: 0.1,
} as const;
export const SOURCE_KINDS = [
  'reality_outcome',
  'user_said',
  'user_confirmed',
  'independent_statement',
  'verifiable_original',
  'own_reasoning',
  'ai_conversation',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SourceInputSchema = Type.Object(
  { kind: Type.Enum(SOURCE_KINDS), label: Text, ref: Type.Optional(Nullable(Type.String())) },
  STRICT,
);
export type SourceInput = Static<typeof SourceInputSchema>;
export const SourcePatchSchema = Type.Partial(SourceInputSchema, STRICT);
export type SourcePatch = Static<typeof SourcePatchSchema>;
export const SourceSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(SourceInputSchema).properties,
  w: Type.Union([Type.Literal(1), Type.Literal(0.5), Type.Literal(0.1)]),
});
export type Source = Static<typeof SourceSchema>;

export const CONCERN_KINDS = ['goal', 'commitment', 'open_question', 'exploration'] as const;
export const CONCERN_LIFECYCLES = ['watching', 'active', 'pending_close', 'closed'] as const;
export const CHANNELS = ['silent', 'next_report', 'popup', 'interrupt'] as const;
export const ActivitySchema = Type.Object(
  {
    id: IdSchema,
    kind: Type.Enum(['communicate', 'explore', 'act']),
    status: Type.Enum(['ongoing', 'waiting', 'ended']),
    summary: Type.String(),
    waitingFor: Nullable(Type.String()),
  },
  STRICT,
);
export type Activity = Static<typeof ActivitySchema>;
export const CriterionSchema = Type.Object(
  { id: IdSchema, text: Text, target: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })) },
  STRICT,
);
export type Criterion = Static<typeof CriterionSchema>;

export const ConcernTriggerSchema = Type.Object({
  id: IdSchema, condition: Text, kind: Type.Enum(['time', 'inbox', 'task']),
  at: Nullable(IsoTimeSchema), match: Nullable(Type.String()), taskId: Nullable(IdSchema),
  registeredAt: IsoTimeSchema,
}, STRICT);
export type ConcernTrigger = Static<typeof ConcernTriggerSchema>;

export const ConcernInputSchema = Type.Object(
  {
    title: Text,
    kind: Type.Enum(CONCERN_KINDS),
    why: Text,
    initiator: Type.Enum(['user', 'brain']),
    lifecycle: Type.Optional(Type.Enum(CONCERN_LIFECYCLES)),
    activities: Type.Optional(Type.Array(ActivitySchema)),
    waitConditions: Type.Optional(Type.Array(Text)),
    triggerConditions: Type.Optional(Type.Array(Text)),
    triggers: Type.Optional(Type.Array(ConcernTriggerSchema)),
    completionCriteria: Type.Optional(Nullable(Type.Array(CriterionSchema))),
    channel: Type.Optional(Type.Enum(CHANNELS)),
    understanding: Type.Optional(Nullable(Type.String())),
    referencedByUser: Type.Optional(Type.Boolean()),
    agreementIds: Type.Optional(IdList),
  },
  STRICT,
);
export type ConcernInput = Static<typeof ConcernInputSchema>;
export const ConcernPatchSchema = Type.Partial(ConcernInputSchema, STRICT);
export type ConcernPatch = Static<typeof ConcernPatchSchema>;
export const ConcernSchema = Type.Object({ ...OBJECT_META, ...Type.Required(ConcernInputSchema).properties });
export type Concern = Static<typeof ConcernSchema>;

export const JUDGMENT_STATUSES = ['active', 'deferred', 'retired'] as const;
export const JUDGMENT_OUTCOMES = ['happened', 'not_happened', 'void'] as const;
export const VerificationSchema = Type.Object(
  {
    summary: Type.String(),
    supportingEvidenceIds: IdList,
    refutingEvidenceIds: IdList,
    scope: Type.String(),
    checked: Type.Boolean(),
  },
  STRICT,
);
export const DisagreementSchema = Type.Object(
  {
    userPosition: Type.String(),
    brainPosition: Type.String(),
    userBasis: Type.String(),
    brainBasis: Type.String(),
    whatWouldChangeUser: Type.String(),
    whatWouldChangeBrain: Type.String(),
  },
  STRICT,
);
export type Disagreement = Static<typeof DisagreementSchema>;

export const JudgmentInputSchema = Type.Object(
  {
    forecast: Type.Optional(Type.Boolean()),
    statement: Text,
    explanation: Type.String(),
    concernId: Type.Optional(Nullable(IdSchema)),
    uncertainty: Type.Optional(Nullable(Type.String())),
    verification: Type.Optional(VerificationSchema),
    disagreement: Type.Optional(Nullable(DisagreementSchema)),
    stale: Type.Optional(Type.Boolean()),
    applicability: Type.Optional(Nullable(Type.String())),
    proposedP: Type.Optional(Nullable(Probability)),
    prior: Type.Optional(Nullable(Probability)),
    deadline: Type.Optional(Nullable(IsoTimeSchema)),
    status: Type.Optional(Type.Enum(JUDGMENT_STATUSES)),
    discussing: Type.Optional(Type.Boolean()),
    deferredUntil: Type.Optional(Nullable(IsoTimeSchema)),
    assumedTrue: Type.Optional(Type.Boolean()),
    cheapestTest: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))),
  },
  STRICT,
);
export type JudgmentInput = Static<typeof JudgmentInputSchema>;
export const JudgmentPatchSchema = Type.Partial(JudgmentInputSchema, STRICT);
export type JudgmentPatch = Static<typeof JudgmentPatchSchema>;
export const JudgmentConfirmedSchema = Type.Partial(
  Type.Object({
    p: Nullable(Probability),
    outcome: Nullable(Type.Enum(JUDGMENT_OUTCOMES)),
    outcomeAt: Nullable(IsoTimeSchema),
  }),
  { ...STRICT, minProperties: 1 },
);
export type JudgmentConfirmed = Static<typeof JudgmentConfirmedSchema>;
export const JudgmentSchema = Type.Object({
  ...OBJECT_META,
  ...CONFIRMATION_META,
  ...Type.Required(JudgmentInputSchema).properties,
  ...Type.Required(JudgmentConfirmedSchema).properties,
});
export type Judgment = Static<typeof JudgmentSchema>;

export const EVIDENCE_IDENTITIES = ['quote', 'observation', 'fact', 'speculation', 'agreement'] as const;
export const EVIDENCE_KINDS = ['file', 'receipt', 'web', 'outcome', 'screenshot_digest', 'message'] as const;
export const StanceSchema = Type.Object(
  { judgmentId: IdSchema, stance: Type.Enum(['supports', 'refutes']), countedInP: Type.Optional(Type.Boolean()) },
  STRICT,
);
export const EvidenceScopeSchema = Type.Object(
  { conditions: Type.String(), proves: Type.String(), doesNotProve: Type.String() },
  STRICT,
);
export const EvidenceInputSchema = Type.Object(
  {
    content: Text,
    identity: Type.Enum(EVIDENCE_IDENTITIES),
    kind: Type.Enum(EVIDENCE_KINDS),
    sourceId: IdSchema,
    observedAt: IsoTimeSchema,
    stances: Type.Optional(Type.Array(StanceSchema)),
    scope: Type.Optional(EvidenceScopeSchema),
    ref: Type.Optional(Nullable(Type.String())),
    digest: Type.Optional(Nullable(Type.String())),
    taskId: Type.Optional(Nullable(IdSchema)),
    stale: Type.Optional(Type.Boolean()),
  },
  STRICT,
);
export type EvidenceInput = Static<typeof EvidenceInputSchema>;
export const EvidencePatchSchema = Type.Partial(EvidenceInputSchema, STRICT);
export type EvidencePatch = Static<typeof EvidencePatchSchema>;
export const EvidenceSchema = Type.Object({ ...OBJECT_META, ...Type.Required(EvidenceInputSchema).properties });
export type Evidence = Static<typeof EvidenceSchema>;

export const MEMORY_KINDS = ['quote', 'interpretation'] as const;
export const MEMORY_BASES = ['self_reported', 'inferred'] as const;
export const AnchorSchema = Type.Object({ kind: Type.Enum(['message', 'note']), ref: IdSchema }, STRICT);
export const RelatedObjectSchema = Type.Object({ type: Text, id: IdSchema }, STRICT);
export const MemoryEntryInputSchema = Type.Object(
  {
    text: Text,
    kind: Type.Enum(MEMORY_KINDS),
    basis: Type.Enum(MEMORY_BASES),
    sourceId: IdSchema,
    provenance: Type.String(),
    observationKind: Type.Optional(Nullable(Type.String())),
    anchor: Type.Optional(Nullable(AnchorSchema)),
    applicability: Type.Optional(Nullable(Type.String())),
    stale: Type.Optional(Type.Boolean()),
    related: Type.Optional(Type.Array(RelatedObjectSchema)),
    deletedAt: Type.Optional(Nullable(IsoTimeSchema)),
  },
  STRICT,
);
export type MemoryEntryInput = Static<typeof MemoryEntryInputSchema>;
export const MemoryEntryPatchSchema = Type.Partial(MemoryEntryInputSchema, STRICT);
export type MemoryEntryPatch = Static<typeof MemoryEntryPatchSchema>;
export const MemoryEntrySchema = Type.Object({ ...OBJECT_META, ...Type.Required(MemoryEntryInputSchema).properties });
export type MemoryEntry = Static<typeof MemoryEntrySchema>;
