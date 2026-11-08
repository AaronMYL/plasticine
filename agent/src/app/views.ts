// Stored rows → the API's views (shared/api). Only field selection and joins; no decisions.

import type { DeviceView, NoteMetaView, NoteView } from '../../shared/api/index.ts';
import type { Device, NoteRecord } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export function deviceView(device: Device, currentDeviceId: string | null): DeviceView {
  return {
    id: device.id,
    name: device.name,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    current: device.id === currentDeviceId,
    local: device.local === true,
  };
}

export function noteMetaView(note: NoteRecord): NoteMetaView {
  return {
    id: note.id,
    title: note.title,
    folder: note.folder,
    pinned: note.pinned,
    private: note.private,
    readOnly: note.readOnly,
    author: note.author,
    preview: note.preview,
    bytes: note.bodyBytes,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    version: note.version,
    deletedAt: note.deletedAt,
    migrated: note.legacyPayload !== null,
  };
}

export function noteView(state: Pick<StateService, 'notes'>, note: NoteRecord): NoteView {
  return { ...noteMetaView(note), markdown: state.notes.readBody(note) };
}
