// /v2/memory/conflicts（11-11 第 11 批第二步）：列出没定的说法冲突（每条带几行、来源、范围、现在以哪条为准），
// 和 Aaron 选以哪条为准。选了「留这条」时其余几行挪进归档（不再成立，能在改动记录里看到）；「都留」只把冲突关掉；
// 「都不要」几行都进归档。冲突里的行白天已经被改过、退休了的，那条冲突不再列出。

import { createHash } from 'node:crypto';
import { MEMORY_CONFLICTS_PATH, ResolveConflictRequestSchema,
  type ConflictLineView, type ConflictListResponse, type ConflictView } from '../../shared/api/memory-conflicts.ts';
import { comparePriority, memorySource, priorityReason } from '../../shared/memory-priority.ts';
import type { MemoryConflict, MemoryDoc, MemoryLine } from '../../shared/state.ts';
import { retireLine } from '../brain/memory-doc-writes.ts';
import { StateError, type StateService } from '../state/index.ts';
import { param, requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

type ConflictState = StateService;

function scopeText(state: ConflictState, line: MemoryLine, doc: MemoryDoc | undefined): string {
  if (line.scopeKind === 'mate') return `只对${state.mates.get(line.scopeRef ?? '')?.name ?? '一位队友'}`;
  if (line.scopeKind === 'project') return state.projects.get(line.scopeRef ?? '')?.name ?? '一个项目';
  if (line.scopeKind === 'contact') return '一位联系人';
  if (doc?.kind === 'project' && doc.projectId !== null) return state.projects.get(doc.projectId)?.name ?? doc.title;
  if (doc?.kind === 'person') return doc.title;
  return '全部';
}

function lineView(state: ConflictState, line: MemoryLine): ConflictLineView {
  const doc = state.memoryDocs.docs.get(line.docId);
  return { id: line.id, text: line.text, docId: line.docId, docTitle: doc?.title ?? '', source: memorySource(line),
    scope: scopeText(state, line, doc), at: line.createdAt };
}

/** 一条还没定的冲突的样子；行已经不全在用（白天改过）就不列。 */
function conflictView(state: ConflictState, conflict: MemoryConflict): ConflictView | null {
  const lines = conflict.lineIds.map((id) => state.memoryDocs.lines.get(id))
    .filter((line): line is MemoryLine => line !== undefined && line.retiredAt === null);
  if (lines.length < 2) return null;
  const ranked = [...lines].sort(comparePriority);
  const winner = ranked[0]!;
  return { id: conflict.id, version: conflict.version, title: conflict.title, lines: lines.map((line) =>
    lineView(state, line)), winnerId: winner.id, reason: priorityReason(winner, ranked[1]!),
  createdAt: conflict.createdAt };
}

export function listConflicts(state: ConflictState): ConflictListResponse {
  return { conflicts: state.memoryConflicts.open().map((conflict) => conflictView(state, conflict))
    .filter((view): view is ConflictView => view !== null) };
}

export const MEMORY_CONFLICT_ROUTES: readonly Route[] = [
  { method: 'GET', path: MEMORY_CONFLICTS_PATH, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: listConflicts(context.deps.state) };
  } },
  { method: 'POST', path: `${MEMORY_CONFLICTS_PATH}/:id/resolve`, auth: true, async handler(context: RequestContext) {
    const auth = requireUserAuth(context);
    const body = checkInput(ResolveConflictRequestSchema, await readJsonBody(context.req), '选以哪条为准');
    const { state } = context.deps;
    return idempotent(context, body.requestId, () => state.transaction(() => {
      const conflict = state.memoryConflicts.require(param(context, 'id'));
      if (conflict.status !== 'open' || conflict.version !== body.version) {
        throw new StateError('version_conflict', '这处冲突已经定过了，请刷新。');
      }
      const live = conflict.lineIds.map((id) => state.memoryDocs.lines.get(id))
        .filter((line): line is MemoryLine => line !== undefined && line.retiredAt === null);
      if (body.resolution === 'kept' && !live.some((line) => line.id === body.keepLineId)) {
        throw new StateError('invalid_input', '要留下的那一条不在这处冲突里，或已经改过。');
      }
      const writer = { actor: 'user' as const, ref: auth.device.id };
      const keep = body.resolution === 'both' ? live.map((line) => line.id)
        : body.resolution === 'kept' ? [body.keepLineId!] : [];
      for (const line of live) {
        if (!keep.includes(line.id)) retireLine(state, line, 'no_longer_true', writer, { conflictId: conflict.id });
      }
      state.memoryConflicts.update(conflict.id, conflict.version, { status: 'resolved', resolution: body.resolution,
        keptLineIds: keep, resolvedAt: new Date().toISOString() });
      return { status: 200, body: listConflicts(state) };
    }), { bodyDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') });
  } },
];

