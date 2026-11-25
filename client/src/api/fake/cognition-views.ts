import type {
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
