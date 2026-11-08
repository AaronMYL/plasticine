// Stored memory entries and agreements → the API's views (shared/api). Only field selection and joins; no decisions.
// 2026-11-05：判断、证据、来源账、≠ 标记删掉；旧记忆条目的来源（sources 表）随来源账一起删了，source 恒为 null，
// openDisagreementId 恒为 null（字段留给旧客户端）。

import type { AgreementView, ChangeRecordView, MemoryEntryView } from '../../shared/api/index.ts';
import type { Agreement, MemoryEntry, VersionEntry } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

// The 验证程度 side of a judgment (《UI 方案》第 8 节判断页右栏): p, the prior, the proposal, the outcome and the
// verification record itself. A change to any of them moves the verification, not the explanation (01bc089 审查).
const VERIFICATION_FIELDS: ReadonlySet<string> = new Set([
  'verification',
  'p',
  'proposedP',
  'prior',
  'outcome',
  'outcomeAt',
]);

export function changeRecords(history: readonly VersionEntry[],
  state?: Pick<StateService, 'devices'>): ChangeRecordView[] {
  return history.map((entry) => ({
    version: entry.version,
    actor: entry.actor,
    deviceName: entry.actor !== 'user' && entry.confirmedByDeviceAt === null ? null
      : state?.devices.get(entry.confirmedByDeviceId ?? entry.actorRef ?? '')?.name ?? '未知设备',
    reason: entry.reason,
    reasonKind: entry.reasonKind,
    fields: entry.fields,
    verificationChanged: entry.fields.some((field) => VERIFICATION_FIELDS.has(field)),
    confirmedByDevice: entry.confirmedByDeviceAt !== null,
    at: entry.createdAt,
  }));
}

export function memoryEntryView(entry: MemoryEntry): MemoryEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    text: entry.text,
    basis: entry.basis,
    observationKind: entry.observationKind,
    provenance: entry.provenance,
    applicability: entry.applicability,
    stale: entry.stale,
    anchor: entry.anchor,
    related: entry.related,
    source: null,
    archivedAt: entry.deletedAt,
    migrated: entry.migratedDefault,
    awaitingConfirmation: false,
    openDisagreementId: null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    version: entry.version,
  };
}

export function agreementView(agreement: Agreement): AgreementView {
  return {
    id: agreement.id,
    kind: agreement.kind,
    title: agreement.title,
    text: agreement.text,
    scope: agreement.scope,
    userQuote: agreement.userQuote,
    quotedAt: agreement.quotedAt,
    perUseConfirmation: agreement.perUseConfirmation,
    premises: agreement.premises,
    state: agreement.state,
    proposedDiff: agreement.proposedDiff,
    termTier: agreement.termTier,
    proposedTerm: agreement.proposedTerm,
    effectiveAt: agreement.effectiveAt,
    migrated: agreement.migratedDefault,
    awaitingConfirmation: false,
    confirmedByDeviceAt: agreement.confirmedByDeviceAt,
    openDisagreementId: null,
    createdAt: agreement.createdAt,
    updatedAt: agreement.updatedAt,
    version: agreement.version,
  };
}
