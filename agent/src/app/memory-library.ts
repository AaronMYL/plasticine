// /v2/memory/search 与 /v2/memory/dreams（shared/api/memory-library.ts，《优化清单》第 10、16 条，11-06 定）：
// 记忆页页头的搜索（带归档），和「昨晚整理了什么」——读最近一次整理、撤销一条、拿不准的挑一个。写都经 brain/ 的函数，
// 按 requestId 幂等、带 version。

import {
  ChooseDreamChangeRequestSchema,
  MEMORY_SEARCH_MAX_HITS,
  MemorySearchQuerySchema,
  UndoDreamChangeRequestSchema,
  type MemoryDreamChangeView,
  type MemoryDreamView,
  type MemorySearchResponse,
} from '../../shared/api/index.ts';
import type { MemoryDreamChange } from '../../shared/state.ts';
import { canUndoChange, chooseDreamCandidate, DreamActionError, searchMemory, undoDreamChange,
  type Writer } from '../brain/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { sourcesOf } from './memory-sources.ts';
import { checkInput, queryObject } from './validate.ts';

/** GET /v2/memory/search?q=&archive= */
export function searchMemoryLines(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(MemorySearchQuerySchema, queryObject(context.url.searchParams, { archive: 'boolean' }),
    '查询参数');
  const hits = searchMemory(context.deps.state, query.q, MEMORY_SEARCH_MAX_HITS, query.archive === true);
  const body: MemorySearchResponse = { hits: hits.map((hit) => ({ topicId: hit.docId, topicTitle: hit.docTitle,
    lineId: hit.line.id, text: hit.line.text, archivedAt: hit.line.archivedAt })) };
  return { status: 200, body };
}

function changeView(state: StateService, change: MemoryDreamChange): MemoryDreamChangeView {
  return {
    id: change.id,
    kind: change.kind,
    text: change.text,
    previous: change.previous,
    topicId: change.docId,
    sources: sourcesOf(state, change.anchors),
    candidates: change.candidates.map((candidate) => ({ text: candidate.text,
      sources: sourcesOf(state, candidate.anchors) })),
    undone: change.undoneAt !== null,
    chosen: change.chosen,
    canUndo: canUndoChange(state, change),
    version: change.version,
  };
}

/** GET /v2/memory/dreams/latest —— 还没有做完的整理是 404（界面不出现入口）。 */
export function latestMemoryDream(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const dream = state.memoryDreams.latest();
  if (dream === undefined || dream.finishedAt === null) {
    throw notFoundError('昨晚的整理');
  }
  const body: MemoryDreamView = { id: dream.id, startedAt: dream.startedAt, finishedAt: dream.finishedAt,
    linesRead: dream.linesRead, conversationsRead: dream.conversationsRead,
    changes: state.memoryDreams.changes(dream.id).map((change) => changeView(state, change)) };
  return { status: 200, body };
}

function requireChange(state: StateService, id: string, version: number): MemoryDreamChange {
  const change = state.memoryDreams.getChange(id);
  if (change === undefined) {
    throw notFoundError('这一条整理');
  }
  if (change.version !== version) {
    throw new ApiError(409, 'version_conflict', '这一条在别处改过了，这次没有改。', { currentVersion: change.version,
      next: '刷新这一页看现在的样子。', extra: { current: changeView(state, change) } });
  }
  return change;
}

function actionReply(state: StateService, act: () => MemoryDreamChange): Reply {
  try {
    return { status: 200, body: changeView(state, act()) };
  } catch (error) {
    if (error instanceof DreamActionError) {
      throw new ApiError(409, 'conflict', error.message, { next: '刷新这一页看现在的样子。' });
    }
    throw error;
  }
}

/** POST /v2/memory/dreams/changes/:id/undo */
export async function undoMemoryDreamChange(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(UndoDreamChangeRequestSchema, await readJsonBody(context.req), '撤销一条整理');
  const { state } = context.deps;
  const writer: Writer = { actor: 'user', ref: auth.device.id };
  return idempotent(context, body.requestId, () => actionReply(state, () =>
    undoDreamChange(state, requireChange(state, param(context, 'id'), body.version), writer)));
}

/** POST /v2/memory/dreams/changes/:id/choose */
export async function chooseMemoryDreamChange(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(ChooseDreamChangeRequestSchema, await readJsonBody(context.req), '挑一个');
  const { state } = context.deps;
  const writer: Writer = { actor: 'user', ref: auth.device.id };
  return idempotent(context, body.requestId, () => actionReply(state, () =>
    chooseDreamCandidate(state, requireChange(state, param(context, 'id'), body.version), body.choice, writer)));
}
