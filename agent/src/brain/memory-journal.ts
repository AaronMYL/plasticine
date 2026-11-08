// 「今天的记录」的写法和「忘掉」（《优化清单》第 10、16 条，11-06 定）。白天：每轮后台记下的短记录、当场写进主题文档的
// 那一条（remembered）都经这里追加；他说「忘掉 X」（卡上同意过）时，现行和归档里的那几行、今天记录里同一件事一起从库里删掉。
// 存取都走 state 的函数（统一索引在那一层接）。

import type { MemoryJournalEntry, MemoryLine } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { sameThing } from './memory-curation-ops.ts';
import type { WrittenOp } from './memory-curation-work.ts';
import type { Writer } from './memory-doc-writes.ts';
import type { PlannedNote } from './memory-journal-ops.ts';

export type JournalState = Pick<StateService, 'memoryJournal' | 'memoryDocs' | 'transaction'>;
export type ForgetState = Pick<StateService, 'memoryJournal' | 'memoryDocs' | 'memoryDreams' | 'memoryCuration'
  | 'erasing'>;

// 「今天」按他的日历日（他在国内；后台没有请求带来的时区，同 daily 的 BACKGROUND_TIME_ZONE）。
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

/** 当场写进主题文档的（加一行、改那一行），在今天的记录里也记一条 remembered，指向写成的那一行。 */
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

/**
 * 他说「忘掉」（11-07 他定真的从库里抹掉）：这几行（现行或归档）删掉，今天记录里指向它们或讲同一件事的也删；昨晚整理的
 * 变更、确认过的推断里存的原文抹掉；每份文档只记一笔 lines_forgotten「删了 n 行」，不带内容和他的原话。一个事务，
 * 删掉的内容用零覆盖。硬线里的「删除」：调用方先出卡、他同意了才调。
 */
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
