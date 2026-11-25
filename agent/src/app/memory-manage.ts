import {
  AddMemoryLineRequestSchema, ApplyCleanupRequestSchema, MEMORY_CLEANUPS_PATH, MoveMemoryLineRequestSchema,
  StartCleanupRequestSchema, type ApplyCleanupResponse, type CleanupItemView, type CleanupView,
  type LatestCleanupResponse,
} from '../../shared/api/memory-manage.ts';
import { memorySectionIn, memorySectionsOf, type MemoryCleanup, type MemoryCleanupItem } from '../../shared/state.ts';
import { addLine, applyCleanup, moveLine, runCleanup, startCleanup } from '../memory/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { memoryLineView, requireLiveLine } from './memory-docs.ts';
import { checkInput } from './validate.ts';

const CLEANUP_TIMEOUT_MS = 10 * 60_000;

function itemView(state: StateService, item: MemoryCleanupItem): CleanupItemView {
  const lines = item.lineIds.flatMap((id) => {
    const line = state.memoryDocs.lines.get(id);
    if (line === undefined) return [];
    return [{ id, text: line.text, docId: line.docId, docTitle: state.memoryDocs.docs.get(line.docId)?.title ?? '' }];
  });
  const to = item.toDocId === null ? undefined : state.memoryDocs.docs.get(item.toDocId);
  return { id: item.id, kind: item.kind, lines, toDocId: item.toDocId, toDocTitle: to?.title ?? null, text: item.text,
    reason: item.reason, applied: item.applied };
}

export function cleanupView(state: StateService, cleanup: MemoryCleanup): CleanupView {
  return { id: cleanup.id, version: cleanup.version, status: cleanup.status, error: cleanup.error,
    items: cleanup.items.map((item) => itemView(state, item)), createdAt: cleanup.createdAt,
    finishedAt: cleanup.finishedAt };
}

function latest(state: StateService): LatestCleanupResponse {
  const cleanup = state.memoryCleanups.latest();
  const overview = state.memoryCleanups.latestOverview();
  return { cleanup: cleanup === undefined ? null : cleanupView(state, cleanup),
    overview: overview?.overview == null ? null
      : { text: overview.overview, at: overview.finishedAt ?? overview.updatedAt } };
}

function requireDoc(state: StateService, docId: string): void {
  const doc = state.memoryDocs.docs.get(docId);
  if (doc === undefined || doc.retiredAt !== null) throw notFoundError('这份记忆');
}

export const MEMORY_MANAGE_ROUTES: readonly Route[] = [
  { method: 'POST', path: '/v2/memory/docs/:docId/lines', auth: true, async handler(context: RequestContext) {
    const auth = requireUserAuth(context);
    const body = checkInput(AddMemoryLineRequestSchema, await readJsonBody(context.req), '加一条记忆');
    const { state } = context.deps;
    const docId = param(context, 'docId');
    requireDoc(state, docId);
    return idempotent(context, body.requestId, () => {
      const kind = state.memoryDocs.docs.require(docId).kind;
      if (body.section !== undefined && !memorySectionsOf(kind).includes(body.section)) {
        throw new ApiError(400, 'invalid_request', '这份记忆里没有这一段。');
      }
      const line = addLine(state, { docId, text: body.text.trim(), basis: 'stated',
        ...(body.section === undefined ? {} : { section: body.section }),
        anchors: [{ kind: 'user_edit', ref: body.requestId }] }, { actor: 'user', ref: auth.device.id });
      return { status: 201, body: { line: memoryLineView(state, line) } };
    });
  } },
  { method: 'POST', path: '/v2/memory/docs/:docId/lines/:lineId/move', auth: true,
    async handler(context: RequestContext) {
      const auth = requireUserAuth(context);
      const body = checkInput(MoveMemoryLineRequestSchema, await readJsonBody(context.req), '把一条记忆挪到别处');
      const { state } = context.deps;
      requireDoc(state, body.toDocId);
      return idempotent(context, body.requestId, () => {
        const line = requireLiveLine(state, param(context, 'docId'), param(context, 'lineId'), body.version);
        const target = state.memoryDocs.docs.require(body.toDocId);
        const section = body.section ?? memorySectionIn(target.kind, line.section);
        if (line.docId === body.toDocId && section === line.section) {
          throw new ApiError(400, 'invalid_request', '已经在这份记忆的这一段里了。');
        }
        if (!memorySectionsOf(target.kind).includes(section)) {
          throw new ApiError(400, 'invalid_request', '这份记忆里没有这一段。');
        }
        if (line.basis === 'tried' && target.kind !== 'how') {
          throw new ApiError(400, 'invalid_request', 'Plasticine 自己试出来的只能留在做事经验里。');
        }
        const moved = moveLine(state, line, body.toDocId, { actor: 'user', ref: auth.device.id }, section);
        return { status: 200, body: { line: memoryLineView(state, moved) } };
      });
    } },
  { method: 'GET', path: `${MEMORY_CLEANUPS_PATH}/latest`, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: latest(context.deps.state) };
  } },
  { method: 'POST', path: MEMORY_CLEANUPS_PATH, auth: true, async handler(context: RequestContext) {
    requireUserAuth(context);
    const body = checkInput(StartCleanupRequestSchema, await readJsonBody(context.req), '全量整理记忆');
    const { state, text, now } = context.deps;
    return idempotent(context, body.requestId, () => {
      const running = state.memoryCleanups.latest()?.status === 'running';
      const cleanup = startCleanup(state);
      if (!running) {
        void runCleanup(state, text, cleanup.id, now, AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
      }
      return { status: 202, body: { cleanup: cleanupView(state, cleanup) } };
    });
  } },
  { method: 'POST', path: `${MEMORY_CLEANUPS_PATH}/:id/apply`, auth: true, async handler(context: RequestContext) {
    const auth = requireUserAuth(context);
    const body = checkInput(ApplyCleanupRequestSchema, await readJsonBody(context.req), '采用整理清单');
    const { state } = context.deps;
    return idempotent(context, body.requestId, () => {
      const current = state.memoryCleanups.get(param(context, 'id'));
      if (current === undefined) throw notFoundError('这份整理清单');
      if (current.status !== 'ready') throw new ApiError(409, 'conflict', '这份清单已经处理过或还没整理完。');
      const { cleanup, report } = applyCleanup(state, current.id, body.version, body.itemIds,
        { actor: 'user', ref: auth.device.id }, body.requestId);
      const response: ApplyCleanupResponse = { cleanup: cleanupView(state, cleanup), ...report };
      return { status: 200, body: response };
    });
  } },
];
