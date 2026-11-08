// 进门（docs/specs/things-and-sources.md 第 2.1、2.2、2.4 节）：来源把原记录照旧写进原表后，在这里记一条触发、
// 过粗筛、写去向，再按去向做事：命中一条在用的规则（候选）就开一条后台线照规则去做（新内核的「触发」）。
// 同一来源同一外部标识只记一次，重复接收是空操作；每条去向只追加。Plasticine 自己发出的东西在进门前丢掉。
// 2026-11-05 Harness 重做：「事」、订阅、细判都删了——推断的规则也直接开线，要不要做由线自己先判断（规则文字里写着）。

import type { IntakeSourceKind, Rule, Trigger, TriggerInput } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { coarseFilter, type CoarseDecision } from './coarse-filter.ts';

export type IntakeState = Pick<StateService, 'intakeSources' | 'triggers' | 'dispositions' | 'rules' | 'transaction'>;

export interface IntakeHandlers {
  /** 命中规则：开一条后台线照规则去做，返回线的 id；开不了（没装新内核）就是 null。在记触发的事务里调。 */
  open(trigger: Trigger, rule: Rule): string | null;
}

export type RecordInput = Omit<TriggerInput, 'sourceId'> & { source: IntakeSourceKind; sourceLabel?: string };

export interface RecordOutcome {
  trigger: Trigger;
  created: boolean;
  decision: CoarseDecision | null;
}

export class IntakeDesk {
  readonly #state: IntakeState;
  readonly #enabled: () => boolean;
  #handlers: IntakeHandlers | null = null;

  constructor(state: IntakeState, enabled: () => boolean = () => true) {
    this.#state = state;
    this.#enabled = enabled;
  }

  setHandlers(handlers: IntakeHandlers): void {
    this.#handlers = handlers;
  }

  get enabled(): boolean {
    return this.#enabled();
  }

  /** 关着就什么都不记，返回 null；来源实例关掉的也只返回 null（原记录照旧在原表）。 */
  record(input: RecordInput): RecordOutcome | null {
    if (!this.enabled) {
      return null;
    }
    const source = this.#source(input.source, input.sourceLabel);
    if (source === undefined || !source.enabled) {
      return null;
    }
    const { source: _kind, sourceLabel: _label, ...rest } = input;
    return this.#state.transaction(() => {
      const { trigger, created } = this.#state.triggers.record({ ...rest, sourceId: source.id });
      if (!created) {
        return { trigger, created, decision: null };
      }
      const decision = coarseFilter(trigger, { sourceConfig: source.config, rules: this.#state.rules.all() });
      this.#act(trigger, decision);
      return { trigger, created, decision };
    });
  }

  #source(kind: IntakeSourceKind, label: string | undefined) {
    const sources = this.#state.intakeSources.byKind(kind);
    return label === undefined ? sources[0] : sources.find((source) => source.label === label);
  }

  #act(trigger: Trigger, decision: CoarseDecision): void {
    const add = this.#state.dispositions.add;
    if (decision.kind !== 'candidate') {
      add({ triggerId: trigger.id, kind: decision.kind, ruleCode: decision.ruleCode, actor: 'code' });
      return;
    }
    add({ triggerId: trigger.id, kind: 'candidate', ruleCode: decision.ruleCode, actor: 'code',
      reason: decision.rule.strength === 'explicit' ? '明确：用户定过的规则' : '推断：线自己先判断要不要做' });
    const lineId = this.#handlers?.open(trigger, decision.rule) ?? null;
    if (lineId !== null) {
      add({ triggerId: trigger.id, kind: 'routed', ruleCode: decision.ruleCode, actor: 'code',
        reason: `开了后台线 ${lineId}` });
    }
  }
}
