// 进门的存取（docs/specs/things-and-sources.md 第 7 节）：来源实例、触发（只追加，同一来源同一外部标识只记一次）、
// 去向（只追加）、规则和它的变化、细判记录。只做存取；粗筛和细判的规矩在 intake/ 和 brain/。

import {
  AssessmentInputSchema,
  AssessmentPatchSchema,
  AssessmentSchema,
  IntakeSourceInputSchema,
  IntakeSourcePatchSchema,
  IntakeSourceSchema,
  RuleEventSchema,
  RuleInputSchema,
  RulePatchSchema,
  RuleSchema,
  TriggerDispositionSchema,
  TriggerSchema,
  type Assessment,
  type AssessmentInput,
  type IntakeSource,
  type IntakeSourceKind,
  type Rule,
  type RuleEvent,
  type RuleEventInput,
  type Trigger,
  type TriggerDisposition,
  type TriggerDispositionInput,
  type TriggerInput,
} from '../../shared/state.ts';
import { appendRows } from './append-rows.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const SOURCE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  kind: 'text',
  label: 'text',
  enabled: 'boolean',
  cursor: 'json',
  config: 'json',
  lastError: 'text',
};
const SOURCE_SPEC: StoreSpec<typeof IntakeSourceSchema, typeof IntakeSourceInputSchema,
  typeof IntakeSourcePatchSchema> = {
  table: 'intake_sources',
  schema: IntakeSourceSchema,
  input: IntakeSourceInputSchema,
  patch: IntakeSourcePatchSchema,
  columns: SOURCE_COLUMNS,
  defaults: { enabled: true, cursor: null, config: {}, lastError: null },
};

const TRIGGER_COLUMNS: ColumnMap = {
  id: 'text',
  sourceId: 'text',
  kind: 'text',
  externalKey: 'text',
  threadKeys: 'json',
  actor: 'text',
  actorSourceKind: 'text',
  addressed: 'boolean',
  occurredAt: 'text',
  receivedAt: 'text',
  refType: 'text',
  refId: 'text',
  summary: 'text',
  facts: 'json',
};

const DISPOSITION_COLUMNS: ColumnMap = {
  id: 'text',
  triggerId: 'text',
  kind: 'text',
  matterId: 'text',
  assessmentId: 'text',
  ruleCode: 'text',
  actor: 'text',
  reason: 'text',
  at: 'text',
};

const RULE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  code: 'text',
  name: 'text',
  text: 'text',
  sourceKinds: 'json',
  triggerKinds: 'json',
  mode: 'text',
  trialable: 'boolean',
  basisKind: 'text',
  basisRef: 'text',
  strength: 'text',
  ruleVersion: 'integer',
};
const RULE_SPEC: StoreSpec<typeof RuleSchema, typeof RuleInputSchema, typeof RulePatchSchema> = {
  table: 'rules',
  schema: RuleSchema,
  input: RuleInputSchema,
  patch: RulePatchSchema,
  columns: RULE_COLUMNS,
  defaults: { basisRef: null, ruleVersion: 1 },
};

const RULE_EVENT_COLUMNS: ColumnMap = {
  id: 'text',
  ruleId: 'text',
  kind: 'text',
  fromMode: 'text',
  toMode: 'text',
  ruleVersion: 'integer',
  actor: 'text',
  evidenceIds: 'json',
  reason: 'text',
  at: 'text',
};

const ASSESSMENT_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  threadKey: 'text',
  triggerIds: 'json',
  status: 'text',
  attempts: 'integer',
  runId: 'text',
  policyVersion: 'text',
  outcome: 'text',
  ruleJudgments: 'json',
  matterId: 'text',
  wouldDo: 'text',
  error: 'text',
  verdict: 'text',
  verdictAt: 'text',
  verdictNote: 'text',
};
const ASSESSMENT_SPEC: StoreSpec<typeof AssessmentSchema, typeof AssessmentInputSchema,
  typeof AssessmentPatchSchema> = {
  table: 'assessments',
  schema: AssessmentSchema,
  input: AssessmentInputSchema,
  patch: AssessmentPatchSchema,
  columns: ASSESSMENT_COLUMNS,
  defaults: { status: 'queued', attempts: 0, runId: null, policyVersion: null, outcome: null, ruleJudgments: [],
    matterId: null, wouldDo: null, error: null, verdict: null, verdictAt: null, verdictNote: null },
};

function createSourceStore(context: StoreContext) {
  const store = new ObjectStore(context, SOURCE_SPEC);
  return {
    create: (input: Parameters<typeof store.create>[0]): IntakeSource => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    /** 每种来源一个实例（第 7.2 节第 2 步）；第 4 批的 iPhone 是 device 种类的另一个实例，按 label 区分。 */
    byKind: (kind: IntakeSourceKind): IntakeSource[] => store.select('kind = $kind', { kind }),
    all: (): IntakeSource[] => store.select('1 = 1', {}, { limit: 500 }),
  };
}

function createTriggerStore(context: StoreContext) {
  const rows = appendRows(context, 'triggers', TriggerSchema, TRIGGER_COLUMNS);
  const byKey = (sourceId: string, externalKey: string): Trigger | undefined =>
    rows.select('source_id = $source_id AND external_key = $external_key',
      { source_id: sourceId, external_key: externalKey }, 'rowid', 1)[0];
  return {
    get: (id: string): Trigger | undefined => rows.select('id = $id', { id }, 'rowid', 1)[0],
    byKey,
    /** 同一来源、同一外部标识只记一次：重复接收回到原来那一条（created = false）。 */
    record(input: TriggerInput): { trigger: Trigger; created: boolean } {
      return context.db.transaction(() => {
        const existing = byKey(input.sourceId, input.externalKey);
        if (existing !== undefined) {
          return { trigger: existing, created: false };
        }
        const trigger = rows.insert({
          id: context.newId(),
          sourceId: input.sourceId,
          kind: input.kind,
          externalKey: input.externalKey,
          threadKeys: input.threadKeys,
          actor: input.actor,
          actorSourceKind: input.actorSourceKind,
          addressed: input.addressed ?? false,
          occurredAt: input.occurredAt,
          receivedAt: input.receivedAt ?? context.now(),
          refType: input.refType,
          refId: input.refId ?? null,
          summary: input.summary,
          facts: input.facts ?? {},
        });
        return { trigger, created: true };
      });
    },
    /** 带这个线索键的触发，新的在前。 */
    withThreadKey: (threadKey: string, limit = 50): Trigger[] => rows.select(
      'EXISTS (SELECT 1 FROM json_each(triggers.thread_keys) WHERE value = $key)', { key: threadKey },
      'received_at DESC, rowid DESC', limit),
    since: (at: string): Trigger[] => rows.select('received_at >= $at', { at }, 'received_at, rowid', 5_000),
    countSince: (at: string): number => rows.count('received_at >= $at', { at }),
  };
}

function createDispositionStore(context: StoreContext) {
  const rows = appendRows(context, 'trigger_dispositions', TriggerDispositionSchema, DISPOSITION_COLUMNS);
  return {
    add(input: TriggerDispositionInput): TriggerDisposition {
      return rows.insert({
        id: context.newId(),
        triggerId: input.triggerId,
        kind: input.kind,
        matterId: input.matterId ?? null,
        assessmentId: input.assessmentId ?? null,
        ruleCode: input.ruleCode ?? null,
        actor: input.actor,
        reason: input.reason ?? null,
        at: context.now(),
      });
    },
    forTrigger: (triggerId: string): TriggerDisposition[] =>
      rows.select('trigger_id = $trigger_id', { trigger_id: triggerId }, 'at, rowid'),
    /** 度量线：某一种去向在一段时间里的行。 */
    ofKindSince: (kind: TriggerDisposition['kind'], at: string): TriggerDisposition[] =>
      rows.select('kind = $kind AND at >= $at', { kind, at }, 'at, rowid', 5_000),
    since: (at: string): TriggerDisposition[] => rows.select('at >= $at', { at }, 'at, rowid', 5_000),
  };
}

function createRuleStore(context: StoreContext) {
  const store = new ObjectStore(context, RULE_SPEC);
  const events = appendRows(context, 'rule_events', RuleEventSchema, RULE_EVENT_COLUMNS);
  return {
    create: (input: Parameters<typeof store.create>[0]): Rule => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    byCode: (code: string): Rule | undefined => store.select('code = $code', { code }, { limit: 1 })[0],
    all: (): Rule[] => store.select('1 = 1', {}, { limit: 500 }),
    addEvent(input: RuleEventInput): RuleEvent {
      return events.insert({
        id: context.newId(),
        ruleId: input.ruleId,
        kind: input.kind,
        fromMode: input.fromMode ?? null,
        toMode: input.toMode ?? null,
        ruleVersion: input.ruleVersion,
        actor: input.actor,
        evidenceIds: input.evidenceIds ?? [],
        reason: input.reason ?? null,
        at: context.now(),
      });
    },
    events: (ruleId: string): RuleEvent[] => events.select('rule_id = $rule_id', { rule_id: ruleId }, 'at, rowid'),
  };
}

function createAssessmentStore(context: StoreContext) {
  const store = new ObjectStore(context, ASSESSMENT_SPEC);
  return {
    create: (input: AssessmentInput): Assessment => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    /** 这个线索键上还没判完的那一批（同一个键同时最多一个细判，期间到的触发并进下一批）。 */
    openFor: (threadKey: string): Assessment[] =>
      store.select("thread_key = $key AND status != 'done'", { key: threadKey }, { limit: 10 }),
    queued: (limit: number): Assessment[] => store.select("status = 'queued'", {}, { limit }),
    running: (): Assessment[] => store.select("status = 'running'", {}, { limit: 100 }),
    forThread: (threadKey: string, limit = 20): Assessment[] =>
      store.select('thread_key = $key', { key: threadKey }, { limit }, 'created_at DESC, id DESC'),
    since: (at: string): Assessment[] => store.select('created_at >= $at', { at }, { limit: 500 }),
  };
}

export function createIntakeStores(context: StoreContext) {
  return {
    intakeSources: createSourceStore(context),
    triggers: createTriggerStore(context),
    dispositions: createDispositionStore(context),
    rules: createRuleStore(context),
  };
}

export type IntakeStores = ReturnType<typeof createIntakeStores>;
