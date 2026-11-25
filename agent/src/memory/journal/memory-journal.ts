import type { MemoryJournalEntry, MemoryLine } from '../../../shared/state.ts';
import type { StateService } from '../../state/index.ts';
import { sameThing } from '../curation/memory-curation-ops.ts';
import type { WrittenOp } from '../curation/memory-curation-work.ts';
import type { Writer } from '../docs/memory-doc-writes.ts';
import type { PlannedNote } from './memory-journal-ops.ts';

export type JournalState = Pick<StateService, 'memoryJournal' | 'memoryDocs' | 'transaction'>;
export type ForgetState = Pick<StateService, 'memoryJournal' | 'memoryDocs' | 'memoryDreams' | 'memoryCuration'
  | 'erasing'>;

export const JOURNAL_TIME_ZONE = 'Asia/Shanghai';

export function journalDay(at: Date, timeZone: string = JOURNAL_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at);
}

export function writeDayNotes(state: JournalState, notes: readonly PlannedNote[], writer: Writer,
  day: string): MemoryJournalEntry[] {
  return state.transaction(() => notes.map((note) => state.memoryJournal.add({ day, kind: note.kind,
    text: note.text, anchors: note.anchors, docId: note.docId, writtenBy: writer.actor, writtenRef: writer.ref })));
}

export function noteRemembered(state: JournalState, written: readonly WrittenOp[], writer: Writer,
  day: string): MemoryJournalEntry[] {
  return state.transaction(() => written.flatMap(({ op, id }) => {
    if ((op.kind !== 'add' && op.kind !== 'revise') || id === null) {
      return [];
    }
    const line = state.memoryDocs.lines.require(id);
    return [state.memoryJournal.add({ day, kind: 'remembered', text: Array.from(line.text).slice(0, 300).join(''),
      anchors: line.anchors, docId: line.docId, lineId: line.id, writtenBy: writer.actor, writtenRef: writer.ref })];
  }));
}

export function forgetMemory(state: ForgetState, lineIds: readonly string[], writer: Writer): {
  lines: MemoryLine[]; journal: number } {
  return state.erasing(() => {
    const lines = state.memoryDocs.lines.forget(lineIds);
    const texts = lines.map((line) => line.text);
    const ids = new Set(lines.map((line) => line.id));
    const related = [...state.memoryJournal.open(), ...state.memoryJournal.archived()].filter((entry) =>
      (entry.lineId !== null && ids.has(entry.lineId)) || texts.some((text) => sameThing(text, entry.text)));
    const journal = state.memoryJournal.forget(related.map((entry) => entry.id));
    state.memoryDreams.forgetLines([...ids]);
    state.memoryCuration.inferences.forgetLines([...ids]);
    for (const docId of new Set(lines.map((line) => line.docId))) {
      state.memoryDocs.events.add({ docId, lineId: null, kind: 'lines_forgotten', actor: writer.actor,
        actorRef: writer.ref, detail: { lines: lines.filter((line) => line.docId === docId).length } });
    }
    return { lines, journal };
  });
}
