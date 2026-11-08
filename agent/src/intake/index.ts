// intake/：进门（第 102 条，docs/specs/things-and-sources.md 第 2 节）。来源实例、触发、粗筛、去向；命中规则就开一条
// 后台线（开线由 app/ 注入，intake/ 不碰 lines/）。它不调模型。

export { coarseFilter, fromPerson } from './coarse-filter.ts';
export type { CoarseDecision, FilterContext } from './coarse-filter.ts';
export { IntakeDesk } from './desk.ts';
export type { IntakeHandlers, RecordInput, RecordOutcome } from './desk.ts';
export { ensureIntake, IPHONE_SOURCE_LABEL, RULE_CODES } from './seed.ts';
export type { RuleCode } from './seed.ts';
export { threadKeys } from './thread-keys.ts';
export { bookmarkTrigger, contactTrigger, deviceTrigger, feedTrigger, mailTrigger, ruleGoal } from './triggers.ts';
export type { MailFacts } from './triggers.ts';
