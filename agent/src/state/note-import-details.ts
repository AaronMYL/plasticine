import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { NoteImportDetails } from '../../shared/api/notes-workspace.ts';
import type { NoteRecord } from '../../shared/state.ts';
import { createLegacyIdMap } from './legacy-ids.ts';
import type { StoreContext } from './object-store.ts';

const LegacyNoteSchema = Type.Object({
  versions: Type.Optional(Type.Object({ import: Type.Optional(Type.Integer()),
    proofread: Type.Optional(Type.Integer()), polish: Type.Optional(Type.Integer()) })),
  history: Type.Optional(Type.Array(Type.Object({ revision: Type.Integer(), markdown: Type.String() }))),
  mergedInto: Type.Optional(Type.Object({ id: Type.String() })),
  merges: Type.Optional(Type.Array(Type.Object({ fromId: Type.String(), splitAt: Type.Optional(Type.String()) }))),
});
const MODES = [['import', 'original'], ['proofread', 'corrected'], ['polish', 'polished']] as const;

export function legacyNoteHistory(payload: unknown): string[] {
  return Value.Check(Type.Object({ note: LegacyNoteSchema }), payload)
    ? (payload.note.history ?? []).map((entry) => entry.markdown) : [];
}

export function createNoteImportDetails(context: StoreContext, require: (id: string) => NoteRecord) {
  const mapping = createLegacyIdMap(context);
  return {
    get(noteId: string): NoteImportDetails {
      const note = require(noteId);
      const payload = note.legacyPayload;
      const result: NoteImportDetails = { variants: [], mergedInto: null, originalIds: [], unresolvedIds: [] };
      if (!Value.Check(Type.Object({ note: LegacyNoteSchema }), payload)) { return result; }
      const raw = payload.note;
      for (const [mode, kind] of MODES) {
        const revision = raw.versions?.[mode];
        const variant = raw.history?.find((entry) => entry.revision === revision);
        if (variant !== undefined) { result.variants.push({ kind, markdown: variant.markdown }); }
      }
      const resolve = (legacyId: string): string | null => {
        const found = mapping.find('files/notes', 'note-json', legacyId);
        if (found?.targetTable === 'notes') { return found.targetId; }
        result.unresolvedIds?.push(legacyId);
        return null;
      };
      result.mergedInto = raw.mergedInto === undefined ? null : resolve(raw.mergedInto.id);
      for (const merge of raw.merges ?? []) {
        if (merge.splitAt !== undefined) { continue; }
        const id = resolve(merge.fromId);
        if (id !== null) { result.originalIds.push(id); }
      }
      return result;
    },
  };
}
