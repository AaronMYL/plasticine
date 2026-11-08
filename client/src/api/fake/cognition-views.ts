// 假实现里造记忆条目、约定的工厂：默认值合 shared 的 schema，按需覆盖几样。
// 假实现、本地开发的预置数据和测试共用。

import type {
  AgreementView,
  MemoryEntryView,
} from '../types.ts';

const AT = '2026-10-27T02:00:00.000Z';

export type MemorySeed = Pick<MemoryEntryView, 'id' | 'kind' | 'text'> & Partial<MemoryEntryView>;

export function memoryEntryView(seed: MemorySeed): MemoryEntryView {
  return {
    basis: seed.kind === 'quote' ? 'self_reported' : 'inferred',
    observationKind: null,
    provenance: seed.kind === 'quote' ? '你在对话里说的' : 'Plasticine 从对话里推的',
    applicability: null,
    stale: false,
    anchor: null,
    related: [],
    source: null,
    archivedAt: null,
    migrated: false,
    awaitingConfirmation: false,
    openDisagreementId: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    ...seed,
  };
}

export type AgreementSeed = Pick<AgreementView, 'id' | 'text'> & Partial<AgreementView>;

export function agreementView(seed: AgreementSeed): AgreementView {
  return {
    kind: 'collaboration',
    title: null,
    scope: '所有对话',
    userQuote: null,
    quotedAt: null,
    perUseConfirmation: false,
    premises: [],
    state: 'active',
    proposedDiff: null,
    effectiveAt: AT,
    migrated: false,
    awaitingConfirmation: false,
    confirmedByDeviceAt: null,
    openDisagreementId: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    ...seed,
  };
}
