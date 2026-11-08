// 白天只记（《优化清单》第 10 条，11-06 定）：每轮对话后，模型把这一轮的新事实、决定、他的纠正、做成的事各提成一条
// 短记录；代码校验后追加进「今天的记录」。校验是纯函数，逐条给拒绝理由：
// - 出处只能是这一轮他说的话；「做成的事」也可以指 Plasticine 这一轮的回答（做成了什么由回答里的结果说明）。
// - 一条 ≤ 300 字、像密钥的不记、和今天已经记过的同一件事不重复记。
// 主题文档白天只在他明说「记住……」时改：那几条走 planCuration（add / revise / new_doc / restated），其余操作一律拒绝。

import { Type, type Static } from 'typebox';
import {
  MEMORY_JOURNAL_TEXT_MAX_CHARS,
  type MemoryAnchor,
  type MemoryJournalEntry,
  type MemoryJournalKind,
} from '../../shared/state.ts';
import { CurationOpSchema, looksLikeSecret, sameThing, type CurationOp, type CurationSource,
  type Rejection } from './memory-curation-ops.ts';

/** 模型能提的记录种类：remembered 只由当场写进主题文档的那条路记。 */
export const DAY_NOTE_KINDS = ['fact', 'decision', 'correction', 'done'] as const;
/** 白天能动主题文档的操作：只有他明说要记住的（加、改那一行、为它新建一篇、他重说了已记住的）。 */
export const DAY_REMEMBER_OPS: readonly CurationOp['op'][] = ['add', 'revise', 'new_doc', 'restated'];
// 一轮最多记这么多条：一轮对话里值得记的事不会更多。
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
  /** 这一轮他说的话（标识 → 锚点）。 */
  sources: ReadonlyMap<string, CurationSource>;
  /** 这一轮的回答（「做成的事」可以指它）。 */
  replyId: string | null;
  docIds: ReadonlySet<string>;
  /** 今天已经记下、还没整理的。 */
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

/** 这一轮的短记录：合格的按给的次序追加，不合格的逐条给理由。 */
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

/** 白天的主题文档操作只留明说要记住的那几种；其余（推断、退休、改说明）留给夜里的整理。 */
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
