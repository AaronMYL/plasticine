// 进门（第 102 条；docs/specs/things-and-sources.md）：来源实例（intake_sources）产生触发（triggers，只追加），每条去向
// 记一行（trigger_dispositions，只追加）；规则（rules）只管「接不接这一类事」，细判记录（assessments）是模型对一批候选
// 的判断。2026-11-05 事（matters）删了，命中规则就开一条后台线（intake/）。
// 用户 11-02 改定：Plasticine 自己判断要做的事直接做（规则一律自动档），不走观察模式；「本来会接」不再产生。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

// ---------- 来源 ----------

// 2026-11-03 第 110 条：书签也是进来的东西（加一条书签记一条触发，粗筛只记）。
// 第 113 条加 contact：Cyber Hunter 网络上联系人发来的话（没有指挥权，只当来源）。
export const INTAKE_SOURCE_KINDS = ['dialog', 'mail', 'calendar', 'feed', 'device', 'github', 'time',
  'system', 'bookmark', 'contact'] as const;
export type IntakeSourceKind = (typeof INTAKE_SOURCE_KINDS)[number];

export const IntakeSourceInputSchema = Type.Object(
  {
    kind: Type.Enum(INTAKE_SOURCE_KINDS),
    label: Text,
    enabled: Type.Optional(Type.Boolean()),
    /** 读到哪；邮件仍用 inbox_sync，这里只指过去。 */
    cursor: Type.Optional(Nullable(Type.Record(Type.String(), Type.Unknown()))),
    /** 来源实例上的少量配置（例如「这些发件人只记」）；不放凭据。 */
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    lastError: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type IntakeSourceInput = Static<typeof IntakeSourceInputSchema>;
export const IntakeSourcePatchSchema = Type.Partial(
  Type.Object({
    enabled: Type.Boolean(),
    cursor: Nullable(Type.Record(Type.String(), Type.Unknown())),
    config: Type.Record(Type.String(), Type.Unknown()),
    lastError: Nullable(Type.String()),
  }),
  STRICT,
);
export type IntakeSourcePatch = Static<typeof IntakeSourcePatchSchema>;
export const IntakeSourceSchema = Type.Object({ ...RECORD_META, ...Type.Required(IntakeSourceInputSchema).properties });
export type IntakeSource = Static<typeof IntakeSourceSchema>;

// ---------- 触发 ----------

/** 触发是谁：用户、他人（person:<地址>）、系统、Plasticine 自己。 */
export const TriggerActorSchema = Type.String({ pattern: '^(user|system|plasticine|person:.{1,200})$' });
/** 被当成证据时的来源类别（shared/state-objects.ts 的 SOURCE_KINDS 取值）。 */
// 第 113 条加 ai_conversation：别人的 Plasticine 说的话（w = 0.1，和 SOURCE_KINDS 里同名的一档）。
export const TRIGGER_SOURCE_KINDS = ['user_said', 'independent_statement', 'own_reasoning', 'system_record',
  'ai_conversation'] as const;
export const TRIGGER_SUMMARY_MAX_CHARS = 200;
export const ThreadKeySchema = Type.String({ minLength: 3, maxLength: 300, pattern: '^[a-z_]+:.+$' });

export const TriggerInputSchema = Type.Object(
  {
    sourceId: IdSchema,
    /** 例如 mail.received、dialog.user_message、task.failure_lesson。 */
    kind: Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z_]+\\.[a-z_]+$' }),
    /** 与 sourceId 联合唯一：重复接收是空操作。 */
    externalKey: Type.String({ minLength: 1, maxLength: 500 }),
    threadKeys: Type.Array(ThreadKeySchema, { maxItems: 20 }),
    actor: TriggerActorSchema,
    actorSourceKind: Type.Enum(TRIGGER_SOURCE_KINDS),
    /** 是不是写给用户本人的（收件人里有用户、或用户在场说的）。 */
    addressed: Type.Optional(Type.Boolean()),
    occurredAt: IsoTimeSchema,
    receivedAt: Type.Optional(IsoTimeSchema),
    refType: Type.String({ minLength: 1, maxLength: 40 }),
    refId: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    summary: Type.String({ maxLength: TRIGGER_SUMMARY_MAX_CHARS }),
    /** 粗筛要用的确定性事实（如有退订头、带 text/calendar、发件人在用户发出过的邮件里）；不放正文。 */
    facts: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  STRICT,
);
export type TriggerInput = Static<typeof TriggerInputSchema>;
export const TriggerSchema = Type.Object({
  id: IdSchema,
  ...Type.Required(TriggerInputSchema).properties,
});
export type Trigger = Static<typeof TriggerSchema>;

export const DISPOSITION_KINDS = [
  'filtered',
  'recorded',
  'delivered',
  'to_main',
  'routed',
  'asked',
  'candidate',
  'assessed',
  'handed_back',
  'released',
  'rerouted',
  /** 留在主会话（主会话收尾门认的一种去向）。 */
  'stayed',
  /** 收尾门补了一次提示还漏：记「留在主会话 · 未派」，计入度量。 */
  'unrouted',
] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];
export const DISPOSITION_ACTORS = ['code', 'plasticine', 'user'] as const;

export const TriggerDispositionInputSchema = Type.Object(
  {
    triggerId: IdSchema,
    kind: Type.Enum(DISPOSITION_KINDS),
    matterId: Type.Optional(Nullable(IdSchema)),
    assessmentId: Type.Optional(Nullable(IdSchema)),
    /** 命中的粗筛规则代号，例如 mail.own、mail.bulk。 */
    ruleCode: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
    actor: Type.Enum(DISPOSITION_ACTORS),
    reason: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  },
  STRICT,
);
export type TriggerDispositionInput = Static<typeof TriggerDispositionInputSchema>;
export const TriggerDispositionSchema = Type.Object({
  id: IdSchema,
  ...Type.Required(TriggerDispositionInputSchema).properties,
  at: IsoTimeSchema,
});
export type TriggerDisposition = Static<typeof TriggerDispositionSchema>;

// ---------- 规则 ----------

/** 档位：关 / 观察 / 自动。用户 11-02 改定直接放开成自动，observe 留着只为读旧行和以后再开。 */
export const RULE_MODES = ['off', 'observe', 'auto'] as const;
export type RuleMode = (typeof RULE_MODES)[number];
export const RULE_BASIS_KINDS = ['user_message', 'decision', 'plasticine', 'migration'] as const;

export const RuleInputSchema = Type.Object(
  {
    /** 稳定代号：代码按它找种下的规则（self_fix、project_overdue……）。 */
    code: Type.String({ pattern: '^[a-z][a-z0-9_]{1,40}$' }),
    name: Text,
    text: Text,
    sourceKinds: Type.Array(Type.Enum(INTAKE_SOURCE_KINDS), { minItems: 1 }),
    /** 声明了哪些触发类别（粗筛第 5 条按它判候选）。 */
    triggerKinds: Type.Array(Type.String({ minLength: 3 }), { minItems: 1 }),
    mode: Type.Enum(RULE_MODES),
    trialable: Type.Boolean(),
    basisKind: Type.Enum(RULE_BASIS_KINDS),
    basisRef: Type.Optional(Nullable(Type.String())),
    /** 依据是用户原话或用户定过的长期委托 = 明确，其余 = 推断（粗筛第 5 条）。 */
    strength: Type.Union([Type.Literal('explicit'), Type.Literal('inferred')]),
    ruleVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  STRICT,
);
export type RuleInput = Static<typeof RuleInputSchema>;
export const RulePatchSchema = Type.Partial(
  Type.Object({ name: Text, text: Text, mode: Type.Enum(RULE_MODES), ruleVersion: Type.Integer({ minimum: 1 }) }),
  STRICT,
);
export type RulePatch = Static<typeof RulePatchSchema>;
export const RuleSchema = Type.Object({ ...RECORD_META, ...Type.Required(RuleInputSchema).properties });
export type Rule = Static<typeof RuleSchema>;

export const RULE_EVENT_KINDS = ['created', 'edited', 'mode_changed', 'released', 'revoked'] as const;
export const RuleEventInputSchema = Type.Object(
  {
    ruleId: IdSchema,
    kind: Type.Enum(RULE_EVENT_KINDS),
    fromMode: Type.Optional(Nullable(Type.Enum(RULE_MODES))),
    toMode: Type.Optional(Nullable(Type.Enum(RULE_MODES))),
    ruleVersion: Type.Integer({ minimum: 1 }),
    actor: Type.Enum(['user', 'plasticine', 'migration', 'maintenance'] as const),
    evidenceIds: Type.Optional(Type.Array(IdSchema)),
    reason: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type RuleEventInput = Static<typeof RuleEventInputSchema>;
export const RuleEventSchema = Type.Object({ id: IdSchema, ...Type.Required(RuleEventInputSchema).properties,
  at: IsoTimeSchema });
export type RuleEvent = Static<typeof RuleEventSchema>;

// ---------- 细判记录 ----------

export const ASSESSMENT_OUTCOMES = ['accept', 'ignore', 'unavailable', 'would_accept'] as const;
export type AssessmentOutcome = (typeof ASSESSMENT_OUTCOMES)[number];
export const ASSESSMENT_STATUSES = ['queued', 'running', 'done'] as const;

export const RuleJudgmentSchema = Type.Object(
  { ruleId: IdSchema, ruleVersion: Type.Integer({ minimum: 1 }), hit: Type.Boolean(), reason: Type.String() },
  STRICT,
);
export type RuleJudgment = Static<typeof RuleJudgmentSchema>;

export const AssessmentInputSchema = Type.Object(
  {
    threadKey: ThreadKeySchema,
    triggerIds: Type.Array(IdSchema, { minItems: 1 }),
    status: Type.Optional(Type.Enum(ASSESSMENT_STATUSES)),
    attempts: Type.Optional(Type.Integer({ minimum: 0 })),
    runId: Type.Optional(Nullable(IdSchema)),
    policyVersion: Type.Optional(Nullable(Type.String())),
    outcome: Type.Optional(Nullable(Type.Enum(ASSESSMENT_OUTCOMES))),
    ruleJudgments: Type.Optional(Type.Array(RuleJudgmentSchema)),
    matterId: Type.Optional(Nullable(IdSchema)),
    wouldDo: Type.Optional(Nullable(Type.String())),
    error: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type AssessmentInput = Static<typeof AssessmentInputSchema>;
export const AssessmentPatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(ASSESSMENT_STATUSES),
  attempts: Type.Integer({ minimum: 0 }),
  triggerIds: Type.Array(IdSchema, { minItems: 1 }),
  runId: Nullable(IdSchema),
  policyVersion: Nullable(Type.String()),
  outcome: Nullable(Type.Enum(ASSESSMENT_OUTCOMES)),
  ruleJudgments: Type.Array(RuleJudgmentSchema),
  matterId: Nullable(IdSchema),
  wouldDo: Nullable(Type.String()),
  error: Nullable(Type.String()),
}), STRICT);
export type AssessmentPatch = Static<typeof AssessmentPatchSchema>;
export const AssessmentSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(AssessmentInputSchema).properties,
  /** 用户确认字段（观察模式的对 / 不对）；用户 11-02 改定不走观察模式，这三列只留着，代码不写。 */
  verdict: Nullable(Type.Union([Type.Literal('right'), Type.Literal('wrong')])),
  verdictAt: Nullable(IsoTimeSchema),
  verdictNote: Nullable(Type.String()),
});
export type Assessment = Static<typeof AssessmentSchema>;
