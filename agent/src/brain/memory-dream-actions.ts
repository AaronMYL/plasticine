// 「昨晚整理了什么」页上他能做的两件事（《优化清单》第 10、16 条，11-06 定）：
// - 撤销一条新加 / 替换：新写的那一行删掉（他说这不该记）；替换的旧说法放回原来的位置（从归档里抄回一行新的，
//   旧行本身留在归档里，历史不改写）。那一行之后又被改过、合并过的，不再给撤销。
// - 拿不准的挑一个：挑中的候选写进那篇文档，出处是候选自己的原话。
// 整理本身（夜里的做梦）是后面一批；这里只管他对整理结果的这两个动作，每个一个事务。

import { YOU_DOC_ID, type MemoryDreamChange, type MemoryLine } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { addLine, docEvent, type Writer } from './memory-doc-writes.ts';

export type DreamState = Pick<StateService, 'memoryDocs' | 'memoryDreams' | 'memoryCuration' | 'projects'
  | 'transaction'>;

export class DreamActionError extends Error {
  readonly code: 'not_undoable' | 'not_choosable';

  constructor(code: 'not_undoable' | 'not_choosable', message: string) {
    super(message);
    this.code = code;
  }
}

/** 这一条现在还能不能撤销：新加 / 替换、还没撤销、写出来的那一行还在用（之后没再被改、合并或忘掉）。 */
export function canUndoChange(state: Pick<StateService, 'memoryDocs'>, change: MemoryDreamChange): boolean {
  if ((change.kind !== 'add' && change.kind !== 'replace') || change.undoneAt !== null || change.lineId === null) {
    return false;
  }
  const line = state.memoryDocs.lines.get(change.lineId);
  return line !== undefined && line.retiredAt === null;
}

function restoreOld(state: DreamState, old: MemoryLine, replacing: MemoryLine, writer: Writer): MemoryLine {
  const restored = state.memoryDocs.lines.add({ docId: old.docId, section: old.section, text: old.text,
    basis: old.basis, anchors: old.anchors, previous: replacing.text, supersedes: [replacing.id],
    inferenceId: old.inferenceId, position: replacing.position, writtenBy: writer.actor, writtenRef: writer.ref });
  docEvent(state, old.docId, restored.id, 'line_revised', writer, { replaced: replacing.id, restoredFrom: old.id });
  return restored;
}

export function undoDreamChange(state: DreamState, change: MemoryDreamChange, writer: Writer): MemoryDreamChange {
  if (!canUndoChange(state, change)) {
    throw new DreamActionError('not_undoable', '这一条已经撤销过，或者那一行之后又改过了，不能再撤销。');
  }
  return state.transaction(() => {
    const line = state.memoryDocs.lines.require(change.lineId ?? '');
    const removed = state.memoryDocs.lines.retire(line.id, line.version, 'forgotten');
    docEvent(state, line.docId, line.id, 'line_retired', writer, { reason: 'forgotten', undoDream: change.id });
    const old = change.oldLineId === null ? undefined : state.memoryDocs.lines.get(change.oldLineId);
    if (change.kind === 'replace' && old !== undefined && old.deletedAt === null) {
      restoreOld(state, old, removed, writer);
    }
    return state.memoryDreams.updateChange(change.id, change.version, { undoneAt: removed.retiredAt ?? '' });
  });
}

export function chooseDreamCandidate(state: DreamState, change: MemoryDreamChange, choice: number,
  writer: Writer): MemoryDreamChange {
  const candidate = change.candidates[choice];
  if (change.kind !== 'unsure' || change.resolvedAt !== null || candidate === undefined) {
    throw new DreamActionError('not_choosable', '这一条已经定过了，或者没有这个选项。');
  }
  return state.transaction(() => {
    const docId = change.docId !== null && state.memoryDocs.docs.get(change.docId)?.retiredAt === null
      ? change.docId : YOU_DOC_ID;
    const line = addLine(state, { docId, text: candidate.text, basis: 'stated', anchors: candidate.anchors }, writer);
    return state.memoryDreams.updateChange(change.id, change.version, { chosen: choice === 1 ? 1 : 0,
      resolvedAt: line.createdAt });
  });
}
