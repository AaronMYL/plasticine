// 粗筛（docs/specs/things-and-sources.md 第 2.2 节）：确定性的，按顺序第一条命中即是——
// 1 Plasticine 自己发出的 → 丢弃；2 来源配置里「只记」的 → 只记；3 用户在主会话说的话、分享 → 交主会话；
// 4 命中某条在用规则声明的触发类别 → 候选（desk.ts 开一条后台线照规则做）；5 其余 → 只记。
// 2026-11-05 Harness 重做：「事」和订阅删了，第 3 步「送到事」随之去掉。纯函数：库里的事实由 desk.ts 读好交进来。

import type { Rule, Trigger } from '../../shared/state.ts';

export interface FilterContext {
  /** 来源实例的配置（例如 recordOnlySenders）。 */
  sourceConfig: Readonly<Record<string, unknown>>;
  /** 在用的规则（自动档；观察档按用户 11-02 改定不再出现）。 */
  rules: readonly Rule[];
}

export type CoarseDecision =
  | { kind: 'filtered' | 'recorded'; ruleCode: string }
  | { kind: 'to_main'; ruleCode: string }
  | { kind: 'candidate'; ruleCode: string; rule: Rule };

/** 人的跟进：用户本人、他人来信；其余是机器的（回执、CI、系统事件）。 */
export function fromPerson(trigger: Pick<Trigger, 'actor'>): boolean {
  return trigger.actor === 'user' || trigger.actor.startsWith('person:');
}

function recordOnly(trigger: Trigger, config: Readonly<Record<string, unknown>>): boolean {
  if (trigger.facts['bulk'] === true || trigger.facts['unsubscribe'] === true) {
    return true;
  }
  const senders = config['recordOnlySenders'];
  const sender = trigger.facts['sender'];
  return Array.isArray(senders) && typeof sender === 'string' && senders.includes(sender);
}

function matchingRule(trigger: Trigger, rules: readonly Rule[]): Rule | null {
  return rules.find((rule) => rule.mode === 'auto' && rule.triggerKinds.includes(trigger.kind)) ?? null;
}

function addressedToMain(trigger: Trigger): boolean {
  if (trigger.kind === 'device.share') {
    return true;
  }
  return trigger.kind === 'dialog.user_message';
}

export function coarseFilter(trigger: Trigger, context: FilterContext): CoarseDecision {
  if (trigger.actor === 'plasticine') {
    return { kind: 'filtered', ruleCode: `${trigger.kind}.own` };
  }
  if (recordOnly(trigger, context.sourceConfig)) {
    return { kind: 'recorded', ruleCode: `${trigger.kind}.record_only` };
  }
  const rule = matchingRule(trigger, context.rules);
  if (addressedToMain(trigger)) {
    return { kind: 'to_main', ruleCode: `${trigger.kind}.main` };
  }
  if (rule !== null) {
    return { kind: 'candidate', ruleCode: `rule.${rule.code}`, rule };
  }
  return { kind: 'recorded', ruleCode: `${trigger.kind}.default` };
}
