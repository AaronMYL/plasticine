import type { SourceContext } from '../../shared/api/lineage.ts';
import type { MemoryEntry } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

type SourceState = Pick<StateService, 'lineMessages' | 'notes' | 'memory'>;

export function memorySource(state: SourceState, anchor: MemoryEntry['anchor']): SourceContext | null {
  if (anchor?.kind === 'message') {
    const said = state.lineMessages.said(anchor.ref);
    return said === undefined ? null : { kind: 'message', ref: said.ref, text: said.text, chatId: said.lineId,
      at: said.createdAt };
  }
  if (anchor?.kind === 'note') {
    const note = state.notes.get(anchor.ref);
    if (note === undefined || note.deletedAt !== null) {
      return null;
    }
    return { kind: 'note', ref: note.id, text: state.notes.readBody(note), chatId: null, at: note.updatedAt };
  }
  return null;
}
