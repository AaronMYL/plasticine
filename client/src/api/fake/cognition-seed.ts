// 本地开发和截图用的记忆和约定：几条保留来源的历史迁入资料（旧指南的约定和词），几条原话和解释。内容是示例，
// 不是真记录。

import type { FakeAgreements } from './fake-agreements.ts';
import type { FakeMemory } from './fake-memory.ts';

export interface CognitionFakes {
  memory: FakeMemory;
  agreements: FakeAgreements;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

const SAID = { id: 'src_said', kind: 'user_said', label: '你在对话里说的', w: 1 } as const;
const INFERRED = { id: 'src_inferred', kind: 'own_reasoning', label: 'Plasticine 自己推的', w: 0.1 } as const;
const STATEMENT = { id: 'src_bank', kind: 'verifiable_original', label: '银行流水原文', w: 0.5 } as const;

function seedMemory(fakes: CognitionFakes, now: Date): void {
  const { memory } = fakes;
  memory.seed({
    id: 'mem_q_reconcile',
    kind: 'quote',
    text: '以后对账这种事，先给我看差异，别直接改。',
    provenance: '10-21 的对话',
    anchor: { kind: 'message', ref: 'msg_reconcile' },
    source: SAID,
    migrated: true,
    awaitingConfirmation: false,
    createdAt: daysAgo(now, 6),
  });
  memory.seed({
    id: 'mem_q_weekend',
    kind: 'quote',
    text: '周末不要给我排任何工作提醒。',
    provenance: '10-19 的对话',
    source: SAID,
    createdAt: daysAgo(now, 8),
  });
  memory.seed({
    id: 'mem_q_continue',
    kind: 'quote',
    text: '我更在意能不能接着做，而不是做得多快。',
    provenance: '笔记《十月计划》',
    anchor: { kind: 'note', ref: 'note_plan' },
    source: SAID,
    createdAt: daysAgo(now, 10),
  });
  memory.seed({
    id: 'mem_i_ledger',
    kind: 'interpretation',
    text: '你对账时更信流水，不太信账单上的汇总数。',
    basis: 'inferred',
    observationKind: '偏好',
    provenance: 'Plasticine 从三次对账的对话里推的',
    applicability: '对账、记账',
    source: INFERRED,
    createdAt: daysAgo(now, 3),
  });
  memory.seed({
    id: 'mem_i_late',
    kind: 'interpretation',
    text: '你晚上十点以后回消息明显变短，多半是累了，那时候不适合问要你定的事。',
    basis: 'inferred',
    observationKind: '作息',
    provenance: '旧版推断，保留推测性质',
    source: INFERRED,
    migrated: true,
    awaitingConfirmation: false,
    createdAt: daysAgo(now, 20),
  });
  memory.seed({
    id: 'mem_i_continue',
    kind: 'interpretation',
    text: '你说「接上」，指的是回到上次停下的那一步，不是重新开始。',
    basis: 'self_reported',
    observationKind: '用词',
    provenance: '你在 10-22 的对话里解释过',
    source: SAID,
    createdAt: daysAgo(now, 5),
  });
}

function seedAgreements(fakes: CognitionFakes, now: Date): void {
  const { agreements } = fakes;
  agreements.seed({
    id: 'agr_reconcile',
    title: '对账先看差异',
    text: '对账发现不一致时，先列出差异等你看，不直接改账。',
    scope: '记账、对账任务',
    userQuote: '以后对账这种事，先给我看差异，别直接改。',
    quotedAt: daysAgo(now, 6),
    migrated: true,
    awaitingConfirmation: false,
    effectiveAt: daysAgo(now, 6),
  });
  agreements.seed({
    id: 'agr_term_continue',
    kind: 'term',
    title: '「接上」',
    text: '「接上」= 回到上次停下的那一步继续，不从头开始。',
    scope: '对话、任务',
    migrated: true,
    awaitingConfirmation: false,
    effectiveAt: daysAgo(now, 30),
  });
  agreements.seed({
    id: 'agr_term_later',
    kind: 'term',
    title: '「先不」',
    text: '「先不」= 这次不做，也不算拒绝，之后可以再提。',
    scope: '要你定卡',
    migrated: true,
    awaitingConfirmation: false,
    effectiveAt: daysAgo(now, 30),
  });
  agreements.seed({
    id: 'agr_weekend',
    title: '周末不排工作提醒',
    text: '周末不排工作提醒。',
    scope: '提醒、通知',
    state: 'under_review',
    proposedDiff: '- 周末不排工作提醒。\n+ 周末不排工作提醒，账单到期这种有截止的除外。',
    effectiveAt: daysAgo(now, 8),
    confirmedByDeviceAt: daysAgo(now, 8),
  });
}

export function seedCognition(fakes: CognitionFakes, now: Date): void {
  seedMemory(fakes, now);
  seedAgreements(fakes, now);
}
