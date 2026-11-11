// /v2/memory/docs 与 /v2/memory/inferences（docs/specs/memory-docs.md 第 7 节）：记忆文档的目录、一份文档、拿不准的列表、
// 确认 / 否掉一条推断（本人会话确认，同约定确认）、用户改一行和退休一行。写操作按 requestId 幂等、核对 version，
// 过时就 409 带现在的样子；行和推断怎么写由 brain/ 的写法决定，这里只校验请求、组装视图。

import {
  DecideMemoryInferenceRequestSchema,
  EditMemoryLineRequestSchema,
  MEMORY_METRIC_DAYS,
  MemoryDocQuerySchema,
  MemoryInferenceQuerySchema,
  RetireMemoryLineRequestSchema,
  COGNITION_PAGE_DEFAULT,
  type MemoryAnchorView,
  type MemoryDocDirectoryResponse,
  type MemoryDocResponse,
  type MemoryDocRowView,
  type MemoryInferenceListResponse,
  type MemoryInferenceResponse,
  type MemoryInferenceView,
  type MemoryLineResponse,
  type MemoryLineView,
} from '../../shared/api/index.ts';
import type { MemoryAnchor, MemoryDoc, MemoryDocKind, MemoryInference, MemoryLine } from '../../shared/state.ts';
import { decideInference, docFullness, retireLine, reviseLine } from '../brain/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

// 锚点摘录：够认出是哪句话，全文在原消息里。
const EXCERPT_CHARS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const KIND_ORDER: readonly MemoryDocKind[] = ['you', 'rules', 'project', 'person', 'topic'];

type ViewState = Pick<StateService, 'memoryDocs' | 'memoryCuration' | 'lineMessages' | 'memory' | 'projects'
  | 'transaction'>;

function excerpt(text: string): string {
  return Array.from(text).slice(0, EXCERPT_CHARS).join('');
}

function anchorView(state: ViewState, anchor: MemoryAnchor): MemoryAnchorView {
  const empty = { ...anchor, excerpt: null, at: null, chatId: null };
  if (anchor.kind === 'message') {
    // 他说的话在线里（line:<线>:<seq>，2026-11-05 旧对话迁进主线时锚点一起改过来）；「事」的线没迁，链不回了。
    const said = state.lineMessages.said(anchor.ref);
    return said === undefined ? empty : { ...anchor, excerpt: excerpt(said.text), at: said.createdAt,
      chatId: said.lineId };
  }
  if (anchor.kind === 'memory_entry') {
    const entry = state.memory.get(anchor.ref);
    return entry === undefined ? empty : { ...anchor, excerpt: excerpt(entry.text), at: entry.createdAt, chatId: null };
  }
  return empty;
}

export function memoryLineView(state: ViewState, line: MemoryLine): MemoryLineView {
  return {
    id: line.id,
    docId: line.docId,
    section: line.section,
    text: line.text,
    basis: line.basis,
    anchors: line.anchors.map((anchor) => anchorView(state, anchor)),
    previous: line.previous,
    supersedes: line.supersedes,
    inferenceId: line.inferenceId,
    writtenBy: line.writtenBy,
    migrated: line.migratedDefault,
    retiredAt: line.retiredAt,
    retiredReason: line.retiredReason,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
    version: line.version,
  };
}

function docRowView(state: ViewState, doc: MemoryDoc): MemoryDocRowView {
  const size = docFullness(state, doc);
  return { id: doc.id, kind: doc.kind, title: doc.title, summary: doc.summary, projectId: doc.projectId,
    lines: size.lines, chars: size.chars, charLimit: size.limit,
    pendingInferences: state.memoryCuration.inferences.pendingForDoc(doc.id).length,
    updatedAt: doc.updatedAt, version: doc.version };
}

function inferenceView(state: ViewState, inference: MemoryInference): MemoryInferenceView {
  return { id: inference.id, docId: inference.docId,
    docTitle: state.memoryDocs.docs.get(inference.docId)?.title ?? '', section: inference.section,
    text: inference.text, why: inference.why, anchors: inference.anchors.map((anchor) => anchorView(state, anchor)),
    status: inference.status, decidedAt: inference.decidedAt, lineId: inference.lineId,
    createdAt: inference.createdAt, updatedAt: inference.updatedAt, version: inference.version };
}

function migrationView(state: ViewState, now: Date): MemoryDocDirectoryResponse['migration'] {
  const migration = state.memoryCuration.migration;
  const current = migration.state();
  const progress = migration.progress(current?.cutoff ?? now.toISOString());
  if (current === undefined) {
    return { status: 'not_started', ...progress };
  }
  return { status: current.finishedAt === null ? 'running' : 'finished', ...progress };
}

/** GET /v2/memory/docs */
export function getMemoryDocDirectory(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const now = context.deps.now();
  const docs = state.memoryDocs.docs.live().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || b.updatedAt.localeCompare(a.updatedAt));
  const jobs = state.memoryCuration.jobs;
  const since = new Date(now.getTime() - MEMORY_METRIC_DAYS * DAY_MS).toISOString();
  const body: MemoryDocDirectoryResponse = {
    docs: docs.map((doc) => docRowView(state, doc)),
    pendingInferences: state.memoryCuration.inferences.count('pending'),
    migration: migrationView(state, now),
    curation: { queued: jobs.count('queued'), running: jobs.count('running'), failed: jobs.count('failed'),
      lastError: jobs.withStatus('failed')[0]?.error ?? null },
    metrics: { since, restated: state.memoryDocs.events.count('restated', since),
      usedLines: state.memoryDocs.events.usedLines(since) },
  };
  return { status: 200, body };
}

function requireDoc(state: ViewState, id: string): MemoryDoc {
  const doc = state.memoryDocs.docs.get(id);
  if (doc === undefined) {
    throw notFoundError('这份记忆文档');
  }
  return doc;
}

/** GET /v2/memory/docs/:id?includeRetired= */
export function getMemoryDoc(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const query = checkInput(MemoryDocQuerySchema,
    queryObject(context.url.searchParams, { includeRetired: 'boolean' }), '查询参数');
  const doc = requireDoc(state, param(context, 'id'));
  const body: MemoryDocResponse = {
    doc: docRowView(state, doc),
    lines: state.memoryDocs.lines.live(doc.id).map((line) => memoryLineView(state, line)),
    ...(query.includeRetired === true
      ? { retired: state.memoryDocs.lines.retired(doc.id).map((line) => memoryLineView(state, line)) } : {}),
  };
  return { status: 200, body };
}

/** GET /v2/memory/inferences?status=&limit=&offset= */
export function listMemoryInferences(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const types = { limit: 'integer', offset: 'integer' } as const;
  const query = checkInput(MemoryInferenceQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
  const offset = query.offset ?? 0;
  const page = state.memoryCuration.inferences.list(query.status ?? 'pending', { limit: limit + 1, offset });
  const body: MemoryInferenceListResponse = {
    inferences: page.slice(0, limit).map((inference) => inferenceView(state, inference)),
    nextOffset: page.length > limit ? offset + limit : null,
  };
  return { status: 200, body };
}

function inferenceConflict(state: ViewState, current: MemoryInference, message: string,
  code = 'version_conflict'): ApiError {
  return new ApiError(409, code, message, { currentVersion: current.version,
    next: '看 current 里现在的样子，需要的话用最新的 version 再来。',
    extra: { current: inferenceView(state, current) } });
}

function decide(context: RequestContext, decision: 'confirmed' | 'rejected'): Promise<Reply> {
  const id = param(context, 'id');
  const { state } = context.deps;
  const label = decision === 'confirmed' ? '确认推断' : '否掉推断';
  const check = (value: unknown) => checkInput(DecideMemoryInferenceRequestSchema, value, label);
  return confirmedWrite(context, check, (body, confirmation) => {
    const current = state.memoryCuration.inferences.get(id);
    if (current === undefined) {
      throw notFoundError('这条拿不准的推断');
    }
    if (current.status !== 'pending') {
      throw inferenceConflict(state, current, '这条推断已经定过了，这次没有改。', 'conflict');
    }
    if (current.version !== body.version) {
      throw inferenceConflict(state, current, '这条推断在别处改过了，这次没有定。');
    }
    const reason = body.reason ?? (decision === 'confirmed' ? '用户在设备上确认这条推断' : '用户在设备上否掉这条推断');
    const result = decideInference(state, current, decision, confirmation, reason);
    const response: MemoryInferenceResponse = { inference: inferenceView(state, result.inference),
      line: result.line === null ? null : memoryLineView(state, result.line) };
    return { status: 200, body: response };
  });
}

/** POST /v2/memory/inferences/:id/confirm —— 本人会话确认。 */
export function confirmMemoryInference(context: RequestContext): Promise<Reply> {
  return decide(context, 'confirmed');
}

/** POST /v2/memory/inferences/:id/reject —— 本人会话确认。 */
export function rejectMemoryInference(context: RequestContext): Promise<Reply> {
  return decide(context, 'rejected');
}

/** 路径里的那一行：要在这份文档里、版本对得上、还在用。 */
export function requireLiveLine(state: ViewState, docId: string, lineId: string, version: number): MemoryLine {
  const line = state.memoryDocs.lines.get(lineId);
  if (line === undefined || line.docId !== docId) {
    throw notFoundError('这份文档里的这一行');
  }
  const conflict = (message: string, code: string) => new ApiError(409, code, message, {
    currentVersion: line.version, next: '看 current 里现在的样子再决定。',
    extra: { current: memoryLineView(state, line) } });
  if (line.retiredAt !== null) {
    throw conflict('这一行已经退休了，不再接受改动；迟到的改动不会把它带回来。', 'conflict');
  }
  if (line.version !== version) {
    throw conflict('这一行在别处改过了，你的改动基于旧版本，这次没有改。', 'version_conflict');
  }
  return line;
}

/** PUT /v2/memory/docs/:docId/lines/:lineId —— 新行替代旧行，旧文字留作「之前」，锚点加上这次改动。 */
export async function editMemoryLine(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(EditMemoryLineRequestSchema, await readJsonBody(context.req), '改一行记忆');
  const { state } = context.deps;
  const docId = param(context, 'docId');
  const lineId = param(context, 'lineId');
  return idempotent(context, body.requestId, () => {
    const line = requireLiveLine(state, docId, lineId, body.version);
    const text = body.text.trim();
    if (text === line.text) {
      const same: MemoryLineResponse = { line: memoryLineView(state, line) };
      return { status: 200, body: same };
    }
    const written = reviseLine(state, line, text, [{ kind: 'user_edit', ref: body.requestId }],
      { actor: 'user', ref: auth.device.id }, 'edited');
    const response: MemoryLineResponse = { line: memoryLineView(state, written) };
    return { status: 200, body: response };
  });
}

/** POST /v2/memory/docs/:docId/lines/:lineId/retire —— 用户要忘掉：整行退休，行还在。 */
export async function retireMemoryLine(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(RetireMemoryLineRequestSchema, await readJsonBody(context.req), '忘掉一行记忆');
  const { state } = context.deps;
  const docId = param(context, 'docId');
  const lineId = param(context, 'lineId');
  return idempotent(context, body.requestId, () => {
    const line = requireLiveLine(state, docId, lineId, body.version);
    const retired = retireLine(state, line, 'forgotten', { actor: 'user', ref: auth.device.id },
      { requestId: body.requestId });
    const response: MemoryLineResponse = { line: memoryLineView(state, retired) };
    return { status: 200, body: response };
  });
}
