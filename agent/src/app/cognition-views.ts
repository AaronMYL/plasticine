import type { ChangeRecordView, MemoryEntryView } from '../../shared/api/index.ts';
import type { MemoryEntry, VersionEntry } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

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
