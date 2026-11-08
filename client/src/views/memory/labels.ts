// 记忆页、判断页共用的中文写法：谁改的、为什么改、来源和它的 w（w 只说来源，等宽数字，不用颜色，第 19 条）。

import type { AgreementView, ChangeRecordView, MemoryEntryView } from '../../api/types.ts';

export const ACTOR_TEXT: Readonly<Record<ChangeRecordView['actor'], string>> = {
  user: '你',
  brain: 'Plasticine',
  hand: '手',
  system: '系统',
  migration: '迁移',
};

export const REASON_KIND_TEXT: Readonly<Record<NonNullable<ChangeRecordView['reasonKind']>, string>> = {
  new_evidence: '新证据',
  reasoning_fix: '推理纠错',
  premise_clarified: '前提澄清',
  context_changed: '情境变化',
  user_correction: '用户纠正',
};

export const BASIS_TEXT: Readonly<Record<MemoryEntryView['basis'], string>> = {
  self_reported: '自述',
  inferred: '推断',
};

export const AGREEMENT_KIND_TEXT: Readonly<Record<AgreementView['kind'], string>> = {
  collaboration: '协作约定',
  term: '词语约定',
};

export const AGREEMENT_STATE_TEXT: Readonly<Record<AgreementView['state'], string>> = {
  active: '生效',
  under_review: '待议',
  revoked: '已撤',
};

/** A live question and the historical source are independent. */
export const AWAITING_TEXT = '有一项待你回答';

