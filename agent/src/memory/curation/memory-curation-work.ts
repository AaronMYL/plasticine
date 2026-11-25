import { Type, type Static } from 'typebox';
import {
  MEMORY_DOC_COMPACT_RATIO,
  MEMORY_LINE_MAX_CHARS,
  GRANTS_DOC_ID,
  PROACTIVE_DOC_ID,
  RULES_DOC_ID,
  YOU_DOC_ID,
  type MemoryAnchor,
  type MemoryDoc,
  type MemoryEntry,
  type MemoryJob,
  type MemoryLine,
} from '../../../shared/state.ts';
import type { StateService } from '../../state/index.ts';
import { looksLikeSecret, similarity, type CurationPlan, type CurationSnapshot, type CurationSource,
  type PlannedOp, type Rejection } from './memory-curation-ops.ts';
import { addLine, docEvent, docFullness, mergeLines, proposeInference, retireLine, reviseLine,
  type Writer } from '../docs/memory-doc-writes.ts';

export type CurationState = Pick<StateService, 'memoryDocs' | 'memoryCuration' | 'projects' | 'transaction'
  | 'lineMessages' | 'memory' | 'memoryJournal'>;

const MESSAGE_CHARS = 4_000;
const REPLY_CHARS = 4_000;
const RELATED_DOCS = 6;
const MATERIAL_LINE_CHARS = 24_000;
const TODAY_MATERIAL_ENTRIES = 120;

export function turnSources(state: CurationState, job: MemoryJob): Map<string, CurationSource> {
  const sources = new Map<string, CurationSource>();
  for (const ref of job.sourceIds) {
    const source = state.lineMessages.said(ref);
    if (source?.origin?.kind === 'user') {
      sources.set(ref, { anchors: [{ kind: 'message', ref }], stated: true });
    }
  }
  return sources;
}

export function entrySource(entry: MemoryEntry): CurationSource {
  const anchors: MemoryAnchor[] = [{ kind: 'memory_entry', ref: entry.id }];
  if (entry.anchor !== null) {
    anchors.push({ kind: entry.anchor.kind, ref: entry.anchor.ref });
  }
  return { anchors, stated: entry.basis === 'self_reported' };
}

export function snapshot(state: CurationState, sources: ReadonlyMap<string, CurationSource>): CurationSnapshot {
  const docs = state.memoryDocs.docs.live();
  const live = new Set(docs.map((doc) => doc.id));
  return {
    docs,
    lines: state.memoryDocs.lines.allLive().filter((line) => live.has(line.docId)),
    pending: state.memoryCuration.inferences.list('pending', { limit: 500 }),
    sources,
  };
}

export function directory(state: CurationState, docs: readonly MemoryDoc[]) {
  return docs.map((doc) => {
    const size = docFullness(state, doc);
    return { id: doc.id, kind: doc.kind, title: doc.title, summary: doc.summary, chars: size.chars,
      limit: size.limit };
  });
}

const ALWAYS_SHOWN: readonly string[] = [YOU_DOC_ID, RULES_DOC_ID, GRANTS_DOC_ID, PROACTIVE_DOC_ID];

export function relatedLines(state: CurationState, docs: readonly MemoryDoc[], text: string) {
  const scored = docs.filter((doc) => !ALWAYS_SHOWN.includes(doc.id)).map((doc) => {
    const lines = state.memoryDocs.lines.live(doc.id);
    const body = [doc.title, doc.summary, ...lines.map((line) => line.text)].join('\n');
    return { doc, lines, score: similarity(body, text) };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, RELATED_DOCS);
  const always = ALWAYS_SHOWN.map((id) => state.memoryDocs.docs.get(id)).filter((doc) => doc !== undefined)
    .map((doc) => ({ doc, lines: state.memoryDocs.lines.live(doc.id) }));
  const chosen = [...always, ...scored];
  type MaterialLine = { id: string; section: string; text: string; basis: string; anchors: MemoryLine['anchors'] };
  const result: Record<string, MaterialLine[]> = {};
  let used = 0;
  for (const { doc, lines } of chosen) {
    const shown: MaterialLine[] = [];
    for (const line of lines) {
      used += Array.from(line.text).length;
      if (used > MATERIAL_LINE_CHARS) {
        break;
      }
      shown.push({ id: line.id, section: line.section, text: line.text, basis: line.basis, anchors: line.anchors });
    }
    result[doc.id] = shown;
  }
  return result;
}

function pendingMaterial(state: CurationState) {
  return state.memoryCuration.inferences.list('pending', { limit: 100 })
    .map((inference) => ({ doc: inference.docId, text: inference.text }));
}

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

export function turnMaterial(state: CurationState, job: MemoryJob): string | null {
  const user = [...turnSources(state, job).keys()].flatMap((id) => {
    const said = state.lineMessages.said(id);
    const text = said?.origin?.userText ?? said?.text ?? '';
    return text.trim() === '' ? [] : [{ id, text: clip(text, MESSAGE_CHARS) }];
  });
  if (user.length === 0) {
    return null;
  }
  const reply = job.replyId === null ? '' : clip(state.lineMessages.said(job.replyId)?.text ?? '', REPLY_CHARS);
  const docs = state.memoryDocs.docs.live();
  const text = user.map((message) => message.text).join('\n');
  const today = state.memoryJournal.open().slice(-TODAY_MATERIAL_ENTRIES)
    .map((entry) => ({ kind: entry.kind, text: entry.text }));
  return JSON.stringify({ docs: directory(state, docs), lines: relatedLines(state, docs, `${text}\n${reply}`),
    today, turn: { user, reply, replyId: job.replyId } });
}

export function migrationMaterial(state: CurationState, entries: readonly MemoryEntry[]): string {
  const docs = state.memoryDocs.docs.live();
  const text = entries.map((entry) => entry.text).join('\n');
  return JSON.stringify({ docs: directory(state, docs), lines: relatedLines(state, docs, text),
    pending: pendingMaterial(state), entries: entries.map((entry) => ({ id: entry.id,
      kind: entry.kind === 'quote' ? '原话' : '解释', stated: entry.basis === 'self_reported',
      text: clip(entry.text, MESSAGE_CHARS), at: entry.createdAt })) });
}

export interface WrittenOp {
  op: PlannedOp;
  id: string | null;
}

export interface ApplyContext {
  writer: Writer;
  jobId: string;
  runId: string | null;
  replyId: string | null;
  migrated: boolean;
}

function writeOp(state: CurationState, op: PlannedOp, context: ApplyContext,
  created: Map<string, string>): string | null {
  const resolve = (target: { id: string } | { ref: string }): string => {
    const id = 'id' in target ? target.id : created.get(target.ref);
    if (id === undefined) {
      throw new Error(`整理计划里引用了还没建的文档 ${'ref' in target ? target.ref : ''}`);
    }
    return id;
  };
  const { writer } = context;
  switch (op.kind) {
    case 'new_doc': {
      const doc = state.memoryDocs.docs.create({ kind: op.docKind, title: op.title, summary: op.summary,
        createdBy: writer.actor });
      docEvent(state, doc.id, null, 'doc_created', writer, { title: op.title, jobId: context.jobId });
      created.set(op.ref, doc.id);
      return doc.id;
    }
    case 'add':
      return addLine(state, { docId: resolve(op.doc), section: op.section, text: op.text, basis: 'stated',
        anchors: op.anchors, migrated: context.migrated }, writer).id;
    case 'revise':
      return reviseLine(state, state.memoryDocs.lines.require(op.line.id), op.text, op.anchors, writer).id;
    case 'retire':
      retireLine(state, state.memoryDocs.lines.require(op.line.id), op.reason, writer, { sources: op.sourceIds });
      return op.line.id;
    case 'summary': {
      const doc = state.memoryDocs.docs.require(op.docId);
      state.memoryDocs.docs.update(doc.id, doc.version, { summary: op.summary });
      docEvent(state, doc.id, null, 'doc_summary', writer, { before: doc.summary });
      return null;
    }
    case 'infer':
      return proposeInference(state, { docId: resolve(op.doc), section: op.section, text: op.text, why: op.why,
        anchors: op.anchors, jobId: context.jobId }, writer).id;
    case 'restated':
      if (!context.migrated) {
        docEvent(state, op.line.docId, op.line.id, 'restated', writer, { sourceId: op.sourceId,
          jobId: context.jobId });
      }
      return null;
  }
}

export function applyPlan(state: CurationState, plan: CurationPlan, context: ApplyContext): WrittenOp[] {
  return state.transaction(() => {
    const created = new Map<string, string>();
    const written = plan.ops.map((op) => ({ op, id: writeOp(state, op, context, created) }));
    if (plan.used.length > 0) {
      docEvent(state, null, null, 'lines_used', context.writer, { lineIds: plan.used, runId: context.runId,
        replyId: context.replyId, jobId: context.jobId });
    }
    return written;
  });
}

export function queueCompactions(state: CurationState, docIds: Iterable<string>): string[] {
  const queued: string[] = [];
  for (const docId of new Set(docIds)) {
    const doc = state.memoryDocs.docs.get(docId);
    if (doc === undefined || doc.retiredAt !== null) {
      continue;
    }
    const size = docFullness(state, doc);
    const open = state.memoryCuration.jobs.openCompaction(docId) !== undefined;
    if (size.chars < size.limit * MEMORY_DOC_COMPACT_RATIO || open) {
      continue;
    }
    const n = state.memoryCuration.jobs.countCompactions(docId) + 1;
    state.memoryCuration.jobs.enqueue({ key: `compact:${docId}:${n}`, kind: 'compact', docId, sourceIds: [] });
    queued.push(docId);
  }
  return queued;
}

export function touchedDocs(written: readonly WrittenOp[]): string[] {
  return [...new Set(written.flatMap(({ op, id }) => {
    switch (op.kind) {
      case 'new_doc':
        return id === null ? [] : [id];
      case 'add':
      case 'infer':
        return 'id' in op.doc ? [op.doc.id] : [];
      case 'revise':
      case 'retire':
      case 'restated':
        return [op.line.docId];
      case 'summary':
        return [op.docId];
    }
  }))];
}

export const CompactionOutputSchema = Type.Object({
  merges: Type.Array(Type.Object({ lines: Type.Array(Type.String()), text: Type.String() })),
});
export type CompactionOutput = Static<typeof CompactionOutputSchema>;

export function planCompaction(output: CompactionOutput, lines: readonly MemoryLine[]): {
  merges: { lines: MemoryLine[]; text: string }[]; rejected: Rejection[] } {
  const live = new Map(lines.map((line) => [line.id, line]));
  const taken = new Set<string>();
  const merges: { lines: MemoryLine[]; text: string }[] = [];
  const rejected: Rejection[] = [];
  for (const merge of output.merges) {
    const label = `merge:${merge.lines.join(',')}`;
    const chosen = [...new Set(merge.lines)].map((id) => live.get(id));
    const text = merge.text.trim();
    const before = chosen.reduce((sum, line) => sum + Array.from(line?.text ?? '').length, 0);
    let reason: string | null = null;
    if (chosen.length === 0 || chosen.some((line) => line === undefined)) {
      reason = '有的行不在这份文档里或已经退休';
    } else if (chosen.some((line) => line !== undefined && taken.has(line.id))) {
      reason = '一行只能进一个合并';
    } else if (text === '' || Array.from(text).length > MEMORY_LINE_MAX_CHARS || looksLikeSecret(text)) {
      reason = '合成的一行是空的、太长或像密钥';
    } else if (Array.from(text).length >= before) {
      reason = '合成的一行没有比原来短';
    }
    if (reason !== null) {
      rejected.push({ op: label, reason });
      continue;
    }
    const kept = chosen.filter((line): line is MemoryLine => line !== undefined);
    for (const line of kept) {
      taken.add(line.id);
    }
    merges.push({ lines: kept, text });
  }
  return { merges, rejected };
}

export function applyCompaction(state: CurationState, merges: readonly { lines: MemoryLine[]; text: string }[],
  writer: Writer): number {
  return state.transaction(() => {
    for (const merge of merges) {
      mergeLines(state, merge.lines.map((line) => state.memoryDocs.lines.require(line.id)), merge.text, writer);
    }
    return merges.length;
  });
}
