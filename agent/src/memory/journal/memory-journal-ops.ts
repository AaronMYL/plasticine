import { Type, type Static } from 'typebox';
import {
  MEMORY_JOURNAL_TEXT_MAX_CHARS,
  type MemoryAnchor,
  type MemoryJournalEntry,
  type MemoryJournalKind,
} from '../../../shared/state.ts';
import { CurationOpSchema, looksLikeSecret, sameThing, type CurationOp, type CurationSource,
  type Rejection } from '../curation/memory-curation-ops.ts';

export const DAY_NOTE_KINDS = ['fact', 'decision', 'correction', 'done'] as const;
export const DAY_REMEMBER_OPS: readonly CurationOp['op'][] = ['add', 'revise', 'new_doc', 'restated'];
export const MAX_DAY_NOTES = 20;

const Str = Type.Optional(Type.String());
export const DayNoteSchema = Type.Object({
  kind: Str,
  text: Str,
  doc: Str,
  sources: Type.Optional(Type.Array(Type.String())),
});
export type DayNote = Static<typeof DayNoteSchema>;
export const DayOutputSchema = Type.Object({
  notes: Type.Optional(Type.Array(DayNoteSchema)),
  remember: Type.Optional(Type.Array(CurationOpSchema)),
  used: Type.Optional(Type.Array(Type.String())),
});
export type DayOutput = Static<typeof DayOutputSchema>;

export interface PlannedNote {
  kind: Exclude<MemoryJournalKind, 'remembered'>;
  text: string;
  docId: string | null;
  anchors: MemoryAnchor[];
}

export interface DayContext {
  sources: ReadonlyMap<string, CurationSource>;
  replyId: string | null;
  docIds: ReadonlySet<string>;
  open: readonly MemoryJournalEntry[];
}

function noteLabel(note: DayNote): string {
  return `note:${note.kind ?? ''}`;
}

function noteKind(raw: string | undefined): PlannedNote['kind'] | null {
  return DAY_NOTE_KINDS.find((kind) => kind === raw) ?? null;
}

function anchorsOf(note: DayNote, kind: PlannedNote['kind'], context: DayContext): MemoryAnchor[] | string {
  const ids = [...new Set(note.sources ?? [])];
  if (ids.length === 0) {
    return '没有引用出处';
  }
  const anchors: MemoryAnchor[] = [];
  for (const id of ids) {
    const said = context.sources.get(id);
    if (said !== undefined) {
      anchors.push(...said.anchors);
    } else if (kind === 'done' && id === context.replyId) {
      anchors.push({ kind: 'message', ref: id });
    } else {
      return `出处 ${id} 不是这一轮的对话`;
    }
  }
  return anchors;
}

function checkNote(note: DayNote, context: DayContext, accepted: readonly PlannedNote[]): PlannedNote | string {
  const kind = noteKind(note.kind);
  if (kind === null) {
    return '种类只能是 fact / decision / correction / done';
  }
  const text = (note.text ?? '').trim();
  if (text === '') {
    return '没有文字';
  }
  if (Array.from(text).length > MEMORY_JOURNAL_TEXT_MAX_CHARS) {
    return `超过 ${MEMORY_JOURNAL_TEXT_MAX_CHARS} 字`;
  }
  if (looksLikeSecret(text)) {
    return '像密钥，不记';
  }
  const anchors = anchorsOf(note, kind, context);
  if (typeof anchors === 'string') {
    return anchors;
  }
  if ([...context.open.map((entry) => entry.text), ...accepted.map((entry) => entry.text)]
    .some((known) => sameThing(known, text))) {
    return '今天已经记过同一件事';
  }
  const docId = note.doc !== undefined && context.docIds.has(note.doc) ? note.doc : null;
  return { kind, text, docId, anchors };
}

export function planDayNotes(notes: readonly DayNote[], context: DayContext): {
  notes: PlannedNote[]; rejected: Rejection[] } {
  const accepted: PlannedNote[] = [];
  const rejected: Rejection[] = [];
  notes.forEach((note, index) => {
    if (index >= MAX_DAY_NOTES) {
      rejected.push({ op: noteLabel(note), reason: `一轮最多记 ${MAX_DAY_NOTES} 条` });
      return;
    }
    const checked = checkNote(note, context, accepted);
    if (typeof checked === 'string') {
      rejected.push({ op: noteLabel(note), reason: checked });
    } else {
      accepted.push(checked);
    }
  });
  return { notes: accepted, rejected };
}

export function dayRememberOps(ops: readonly CurationOp[]): { ops: CurationOp[]; rejected: Rejection[] } {
  const kept: CurationOp[] = [];
  const rejected: Rejection[] = [];
  for (const op of ops) {
    if (DAY_REMEMBER_OPS.includes(op.op)) {
      kept.push(op);
    } else {
      rejected.push({ op: `${op.op}:${op.doc ?? op.line ?? ''}`, reason: '白天只记今天的记录，这一步留给夜里的整理' });
    }
  }
  return { ops: kept, rejected };
}
