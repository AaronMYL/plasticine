// 后台整理的材料和落库（docs/specs/memory-docs.md 第 3、5 节）：给模型看什么（目录、相关文档的行、拿不准的、这一轮的话或
// 这一批旧条目），校验过的操作怎么在一个事务里落库，合并压缩怎么校验。模型调用在 memory-curator.ts。

import { Type, type Static } from 'typebox';
import {
  MEMORY_DOC_COMPACT_RATIO,
  MEMORY_LINE_MAX_CHARS,
  RULES_DOC_ID,
  YOU_DOC_ID,
  type MemoryAnchor,
  type MemoryDoc,
  type MemoryEntry,
  type MemoryJob,
  type MemoryLine,
} from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { looksLikeSecret, similarity, type CurationPlan, type CurationSnapshot, type CurationSource,
  type PlannedOp, type Rejection } from './memory-curation-ops.ts';
import { addLine, docEvent, docFullness, mergeLines, proposeInference, retireLine, reviseLine,
  type Writer } from './memory-doc-writes.ts';

export type CurationState = Pick<StateService, 'memoryDocs' | 'memoryCuration' | 'projects' | 'transaction'
  | 'lineMessages' | 'memory' | 'memoryJournal'>;

// 给模型看的：一条用户消息、一次回复各最多这么多字；相关文档最多几份、行的总字数上限（小模型一次读得完）。
const MESSAGE_CHARS = 4_000;
const REPLY_CHARS = 4_000;
const RELATED_DOCS = 6;
const MATERIAL_LINE_CHARS = 24_000;
// 今天已经记下的最多给这么多条（防重复用，最近的在后）。
const TODAY_MATERIAL_ENTRIES = 120;

/** 这一轮线里还在的、他说的话（ref 是 line:<线>:<seq>）：来源只认它们。 */
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

/** 一条旧条目作来源：锚点 = 它自己加它原来的消息 / 笔记；只有用户原话（self_reported）算用户说的。 */
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

// 「关于你」「怎么替你做事」两份总在材料里（第 4 批：规矩要能对上已有的那一行，改它而不是另加）。
const ALWAYS_SHOWN: readonly string[] = [YOU_DOC_ID, RULES_DOC_ID];

/** 「关于你」「怎么替你做事」总在；其余按和这次文字的两字重合挑几份最相关的，行的总字数有上限。 */
export function relatedLines(state: CurationState, docs: readonly MemoryDoc[], text: string) {
  const scored = docs.filter((doc) => !ALWAYS_SHOWN.includes(doc.id)).map((doc) => {
    const lines = state.memoryDocs.lines.live(doc.id);
    const body = [doc.title, doc.summary, ...lines.map((line) => line.text)].join('\n');
    return { doc, lines, score: similarity(body, text) };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, RELATED_DOCS);
  const always = ALWAYS_SHOWN.map((id) => state.memoryDocs.docs.get(id)).filter((doc) => doc !== undefined)
    .map((doc) => ({ doc, lines: state.memoryDocs.lines.live(doc.id) }));
  const chosen = [...always, ...scored];
  const result: Record<string, { id: string; section: string; text: string }[]> = {};
  let used = 0;
  for (const { doc, lines } of chosen) {
    const shown: { id: string; section: string; text: string }[] = [];
    for (const line of lines) {
      used += Array.from(line.text).length;
      if (used > MATERIAL_LINE_CHARS) {
        break;
      }
      shown.push({ id: line.id, section: line.section, text: line.text });
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

/** 一个对话轮的材料：没有可引用的用户消息时返回 null（这一轮不用整理）。 */
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
  // 今天已经记下的：同一件事不再记（第 10 条白天只记）。
  const today = state.memoryJournal.open().slice(-TODAY_MATERIAL_ENTRIES)
    .map((entry) => ({ kind: entry.kind, text: entry.text }));
  return JSON.stringify({ docs: directory(state, docs), lines: relatedLines(state, docs, `${text}\n${reply}`),
    today, turn: { user, reply, replyId: job.replyId } });
}

/** 一批旧条目的材料：每条带它的标识、是原话还是解释、是不是用户说的。 */
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
  /** 写出来的行、推断或文档的标识；重说和改说明没有新对象。 */
  id: string | null;
}

export interface ApplyContext {
  writer: Writer;
  jobId: string;
  runId: string | null;
  replyId: string | null;
  /** 迁移来的行标 migrated_default。 */
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
      // 度量线只数用户在对话里重说；旧条目之间的重复是历史，不算。
      if (!context.migrated) {
        docEvent(state, op.line.docId, op.line.id, 'restated', writer, { sourceId: op.sourceId,
          jobId: context.jobId });
      }
      return null;
  }
}

/** 一次整理的全部操作在一个事务里落库；回复用到的行记一条 lines_used。 */
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

/** 动过的文档里在用文字到了上限的 85%，各排一次合并压缩（已经在排的不重复）。 */
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

/** 合并压缩的校验：行都在这份文档里在用、每行只进一个合并、合成的一行比原来短。 */
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
