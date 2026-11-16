// 记忆文档的写法（docs/specs/memory-docs.md 第 2 节）：后台整理、file_to_project 的决定、记忆页的用户改动都走这里，
// 所以三处写出来的行和事件是同一个样子：加一行、改一行（新行替代旧行，旧文字存进「之前」）、退休一行、合并几行、
// 提一条待确认推断、确认推断成行，每一步在 memory_doc_events 记一笔。每个函数自己一个事务（嵌套时是保存点）。

import { MAIN_SOUL_DEFAULTS } from '../../../shared/soul.ts';
import {
  GRANTS_DOC_ID,
  GRANTS_DOC_TITLE,
  MEMORY_DOC_CHAR_LIMIT,
  PROACTIVE_DOC_ID,
  PROACTIVE_DOC_TITLE,
  RULES_DOC_ID,
  RULES_DOC_TITLE,
  YOU_DOC_ID,
  YOU_DOC_TITLE,
  memorySectionsOf,
  projectDocId,
  type Actor,
  type DeviceConfirmation,
  type MemoryAnchor,
  type MemoryDoc,
  type MemoryDocEventKind,
  type MemoryInference,
  type MemoryLine,
  type MemoryLineBasis,
  type MemoryLineRetireReason,
  type MemoryLineSection,
  type MemoryScopeKind,
  type Project,
} from '../../../shared/state.ts';
import type { StateService } from '../../state/index.ts';

export type DocState = Pick<StateService, 'memoryDocs' | 'memoryCuration' | 'projects' | 'transaction'>;

export interface Writer {
  actor: Actor;
  /** 作业、运行或设备的标识，进事件的 actor_ref。 */
  ref: string | null;
}

// 每篇开头一句话说明「这篇讲什么、什么时候该读」（第 16 条，11-06 定）；「关于你」「怎么替你做事」每轮都读，
// 只写讲什么（设计稿 Plasticine-Memory 的原文）。旧说法是系统自己写的，升级时改成新说法、事件里留旧的。
const YOU_SUMMARY = '身份、住处、作息和长期偏好';
const LEGACY_YOU_SUMMARY = '用户本人：身份、住处、工作、长期习惯和偏好，以及对 Plasticine 的总体要求。';

/** 系统写的旧说明升级成新说法（只改系统自己写的那句；他或整理改过的不动）。 */
function upgradeSummary(state: DocState, doc: MemoryDoc, legacy: string, next: string): MemoryDoc {
  if (doc.summary !== legacy || legacy === next) {
    return doc;
  }
  return state.transaction(() => {
    const updated = state.memoryDocs.docs.update(doc.id, doc.version, { summary: next });
    docEvent(state, doc.id, null, 'doc_summary', { actor: 'system', ref: null }, { before: doc.summary,
      why: '第 16 条：每篇开头一句话说明讲什么、什么时候该读' });
    return updated;
  });
}

/** 「关于你」一直在；没有就建（稳定标识，重复调用不重复建）。 */
export function ensureYouDoc(state: DocState): MemoryDoc {
  const existing = state.memoryDocs.docs.get(YOU_DOC_ID);
  if (existing !== undefined) {
    return upgradeSummary(state, existing, LEGACY_YOU_SUMMARY, YOU_SUMMARY);
  }
  return state.transaction(() => {
    const doc = state.memoryDocs.docs.create({ kind: 'you', title: YOU_DOC_TITLE, summary: YOU_SUMMARY,
      createdBy: 'system' }, { id: YOU_DOC_ID });
    docEvent(state, doc.id, null, 'doc_created', { actor: 'system', ref: null }, { title: doc.title });
    return doc;
  });
}

const RULES_SUMMARY = '说话、做事和对外的规则；每条保留真实来源';
const LEGACY_RULES_SUMMARY = '你要 Plasticine 怎么做事：你明说的规矩，每条链回原话；最前面是不管有没有把握都先问你的几类事。';

/** 「怎么替你做事」一直在；没有就建（稳定标识，重复调用不重复建）。 */
export function ensureRulesDoc(state: DocState): MemoryDoc {
  const existing = state.memoryDocs.docs.get(RULES_DOC_ID);
  if (existing !== undefined) {
    const current = upgradeSummary(state, existing, LEGACY_RULES_SUMMARY, RULES_SUMMARY);
    return current.title === RULES_DOC_TITLE ? current
      : state.memoryDocs.docs.update(current.id, current.version, { title: RULES_DOC_TITLE });
  }
  return state.transaction(() => {
    const doc = state.memoryDocs.docs.create({ kind: 'rules', title: RULES_DOC_TITLE, summary: RULES_SUMMARY,
      createdBy: 'system' }, { id: RULES_DOC_ID });
    docEvent(state, doc.id, null, 'doc_created', { actor: 'system', ref: null }, { title: doc.title });
    for (const item of MAIN_SOUL_DEFAULTS) {
      const line = state.memoryDocs.lines.add({ docId: doc.id, text: item.text, basis: 'system',
        anchors: [{ kind: 'system', ref: `soul-default-${item.key}` }], writtenBy: 'system' });
      docEvent(state, doc.id, line.id, 'line_added', { actor: 'system', ref: null },
        { soulAction: 'add', soulSection: item.section });
    }
    return doc;
  });
}

// 记忆分层（11-15）：两份固定的页，和「关于你」一样一直在。说明写给模型看：这篇讲什么、什么时候该读。
const GRANTS_SUMMARY = '允许直接做的、要先问的、先停着的事，和 Plasticine 答应过的事；做事前、出确认卡前先看';
const PROACTIVE_SUMMARY = '别主动提的事、什么时候别打扰、通知写成什么样；主动发消息、心跳、建议、来信之前先看';

function ensureFixedDoc(state: DocState, id: string, kind: 'grants' | 'proactive', title: string,
  summary: string): MemoryDoc {
  const existing = state.memoryDocs.docs.get(id);
  if (existing !== undefined) {
    return existing;
  }
  return state.transaction(() => {
    const doc = state.memoryDocs.docs.create({ kind, title, summary, createdBy: 'system' }, { id });
    docEvent(state, doc.id, null, 'doc_created', { actor: 'system', ref: null }, { title: doc.title });
    return doc;
  });
}

/** 「承诺和授权」一直在；没有就建（稳定标识，重复调用不重复建）。 */
export function ensureGrantsDoc(state: DocState): MemoryDoc {
  return ensureFixedDoc(state, GRANTS_DOC_ID, 'grants', GRANTS_DOC_TITLE, GRANTS_SUMMARY);
}

/** 「主动告诉你」一直在；没有就建。 */
export function ensureProactiveDoc(state: DocState): MemoryDoc {
  return ensureFixedDoc(state, PROACTIVE_DOC_ID, 'proactive', PROACTIVE_DOC_TITLE, PROACTIVE_SUMMARY);
}

function clipSummary(text: string): string {
  return Array.from(text).slice(0, 150).join('');
}

function projectSummary(project: Project): string {
  return clipSummary(`定下的方向、决定、约束和进展；聊到「${project.name}」时读`);
}

function legacyProjectSummary(project: Project): string {
  return clipSummary(`项目「${project.name}」的档案：定下的决定、约束、分工和进展。`);
}

/** 项目文档就是项目档案，和项目一一对应；用到时补建。 */
export function ensureProjectDoc(state: DocState, project: Project): MemoryDoc {
  const existing = state.memoryDocs.docs.forProject(project.id);
  if (existing !== undefined) {
    return upgradeSummary(state, existing, legacyProjectSummary(project), projectSummary(project));
  }
  return state.transaction(() => {
    const title = Array.from(project.name).slice(0, 60).join('');
    const doc = state.memoryDocs.docs.create({ kind: 'project', title, summary: projectSummary(project),
      projectId: project.id, createdBy: 'system' }, { id: projectDocId(project.id) });
    docEvent(state, doc.id, null, 'doc_created', { actor: 'system', ref: null }, { projectId: project.id });
    return doc;
  });
}

/** 「关于你」「怎么替你做事」「承诺和授权」「主动告诉你」和每个项目的文档。服务启动和每次整理前调一次。 */
export function ensureMemoryDocs(state: DocState): void {
  ensureYouDoc(state);
  ensureRulesDoc(state);
  ensureGrantsDoc(state);
  ensureProactiveDoc(state);
  for (const project of state.projects.all()) {
    ensureProjectDoc(state, project);
  }
}

export function docEvent(state: DocState, docId: string | null, lineId: string | null,
  kind: MemoryDocEventKind, writer: Writer,
  detail: Record<string, unknown>): void {
  state.memoryDocs.events.add({ docId, lineId, kind, actor: writer.actor, actorRef: writer.ref, detail });
}

export interface NewLine {
  docId: string;
  section?: MemoryLineSection;
  text: string;
  basis: MemoryLineBasis;
  anchors: MemoryAnchor[];
  inferenceId?: string;
  migrated?: boolean;
  scopeKind?: MemoryScopeKind;
  scopeRef?: string | null;
}

/** 一行的适用范围，改写、合并、恢复时照抄（11-11）。 */
export function scopeOf(line: Pick<MemoryLine, 'scopeKind' | 'scopeRef'>):
  { scopeKind: MemoryScopeKind; scopeRef: string | null } {
  return { scopeKind: line.scopeKind, scopeRef: line.scopeRef };
}

/** 没写段就进这种文档的第一段；写了这种文档里没有的段不收。 */
function sectionFor(state: DocState, docId: string, section: MemoryLineSection | undefined): MemoryLineSection {
  const allowed = memorySectionsOf(state.memoryDocs.docs.require(docId).kind);
  const chosen = section ?? allowed[0] ?? 'note';
  if (!allowed.includes(chosen)) {
    throw new Error(`这份记忆里没有「${chosen}」这一段`);
  }
  return chosen;
}

export function addLine(state: DocState, line: NewLine, writer: Writer): MemoryLine {
  return state.transaction(() => {
    if (line.basis === 'tried' && state.memoryDocs.docs.require(line.docId).kind !== 'how') {
      throw new Error('Plasticine 自己试出来的只能记在做事经验里');
    }
    const section = sectionFor(state, line.docId, line.section);
    const written = state.memoryDocs.lines.add({ docId: line.docId, section, text: line.text,
      basis: line.basis, anchors: line.anchors, inferenceId: line.inferenceId ?? null, writtenBy: writer.actor,
      writtenRef: writer.ref, scopeKind: line.scopeKind ?? 'all', scopeRef: line.scopeRef ?? null },
    { migratedDefault: line.migrated ?? false });
    docEvent(state, line.docId, written.id, 'line_added', writer, { section: written.section, basis: written.basis });
    return written;
  });
}

/**
 * 同一件事变了：旧行退休（revised / edited），新行接它的位置、存它的文字作「之前」，锚点是旧的加新的
 * （原话为正本：改过的行仍链回最初那句）。
 */
export function reviseLine(state: DocState, old: MemoryLine, text: string, anchors: readonly MemoryAnchor[],
  writer: Writer, reason: Extract<MemoryLineRetireReason, 'revised' | 'edited'> = 'revised'): MemoryLine {
  return state.transaction(() => {
    state.memoryDocs.lines.retire(old.id, old.version, reason);
    const written = state.memoryDocs.lines.add({ docId: old.docId, section: old.section, text,
      basis: writer.actor === 'user' ? 'stated' : old.basis, anchors: mergeAnchors(old.anchors, anchors),
      previous: old.text, supersedes: [old.id], inferenceId: old.inferenceId, position: old.position,
      writtenBy: writer.actor, writtenRef: writer.ref, ...scopeOf(old) });
    const kind = reason === 'edited' ? 'line_edited' : 'line_revised';
    docEvent(state, old.docId, written.id, kind, writer, { replaced: old.id });
    return written;
  });
}

export function retireLine(state: DocState, line: MemoryLine, reason: MemoryLineRetireReason, writer: Writer,
  detail: Record<string, unknown> = {}): MemoryLine {
  return state.transaction(() => {
    const retired = state.memoryDocs.lines.retire(line.id, line.version, reason);
    docEvent(state, line.docId, line.id, 'line_retired', writer, { reason, ...detail });
    return retired;
  });
}

/** 合并压缩：几行合成一行，锚点取并集（模型丢不掉来源），新行接最前那一行的位置。 */
export function mergeLines(state: DocState, lines: readonly MemoryLine[], text: string, writer: Writer): MemoryLine {
  const first = [...lines].sort((a, b) => a.position - b.position)[0];
  if (first === undefined) {
    throw new Error('合并至少要有一行');
  }
  return state.transaction(() => {
    for (const line of lines) {
      state.memoryDocs.lines.retire(line.id, line.version, 'merged');
    }
    const hasSystem = lines.some((line) => line.basis === 'system');
    const allSystem = lines.every((line) => line.basis === 'system');
    if (hasSystem && !allSystem) throw new Error('系统默认规则和用户来源不能合并为同一行。');
    const basis = allSystem ? 'system'
      : lines.every((line) => line.basis === 'stated') ? 'stated' : 'confirmed_inference';
    const inferenceId = lines.find((line) => line.inferenceId !== null)?.inferenceId ?? null;
    const written = state.memoryDocs.lines.add({ docId: first.docId, section: first.section, text, basis,
      anchors: mergeAnchors([], lines.flatMap((line) => line.anchors)), previous: lines.map((line) => line.text)
        .join(' / '), supersedes: lines.map((line) => line.id), inferenceId, position: first.position,
      writtenBy: writer.actor, writtenRef: writer.ref,
      // 范围都一样才照抄；不一样的合成一行时取最宽的「全部」。
      ...(lines.every((line) => line.scopeKind === first.scopeKind && line.scopeRef === first.scopeRef)
        ? scopeOf(first) : { scopeKind: 'all' as const, scopeRef: null }) });
    docEvent(state, first.docId, written.id, 'lines_merged', writer, { merged: lines.map((line) => line.id) });
    return written;
  });
}

export function proposeInference(state: DocState, input: { docId: string; section?: MemoryLineSection; text: string;
  why: string; anchors: MemoryAnchor[]; jobId: string | null }, writer: Writer): MemoryInference {
  return state.transaction(() => {
    const inference = state.memoryCuration.inferences.create({ docId: input.docId, section: input.section ?? 'note',
      text: input.text, why: input.why, anchors: input.anchors, jobId: input.jobId });
    docEvent(state, input.docId, null, 'inference_proposed', writer, { inferenceId: inference.id });
    return inference;
  });
}

/**
 * 用户在设备上确认一条推断：先写确认（用户确认字段），再写成文档里的一行（锚点 = 推断的来源），最后把行记回推断。
 * 否掉只写确认，不成行。
 */
export function decideInference(state: DocState, inference: MemoryInference, decision: 'confirmed' | 'rejected',
  confirmation: DeviceConfirmation, reason: string): { inference: MemoryInference; line: MemoryLine | null } {
  return state.transaction(() => {
    const writer: Writer = { actor: 'user', ref: confirmation.deviceId };
    let decided = state.memoryCuration.inferences.decide(inference.id, inference.version,
      { status: decision, decidedAt: confirmation.confirmedAt }, confirmation, reason);
    if (decision === 'rejected') {
      docEvent(state, inference.docId, null, 'inference_rejected', writer, { inferenceId: inference.id });
      return { inference: decided, line: null };
    }
    const line = addLine(state, { docId: inference.docId, section: inference.section, text: inference.text,
      basis: 'confirmed_inference', anchors: inference.anchors, inferenceId: inference.id }, writer);
    decided = state.memoryCuration.inferences.update(decided.id, decided.version, { lineId: line.id });
    docEvent(state, inference.docId, line.id, 'inference_confirmed', writer, { inferenceId: inference.id });
    return { inference: decided, line };
  });
}

export function mergeAnchors(base: readonly MemoryAnchor[], extra: readonly MemoryAnchor[]): MemoryAnchor[] {
  const seen = new Set<string>();
  const merged: MemoryAnchor[] = [];
  for (const anchor of [...base, ...extra]) {
    const key = `${anchor.kind}:${anchor.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(anchor);
    }
  }
  return merged;
}

/** 一份文档在用的字数和上限；到 85% 就该合并压缩。 */
export function docFullness(state: DocState, doc: MemoryDoc): { chars: number; limit: number; lines: number } {
  const size = state.memoryDocs.lines.size(doc.id);
  return { chars: size.chars, lines: size.lines, limit: doc.charLimit || MEMORY_DOC_CHAR_LIMIT };
}
