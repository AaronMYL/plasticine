// /v2/books/:id 下的标注、大纲与重点、讨论、导出成笔记（用户 2026-11-01 定的图书功能）。

import {
  CreateBookAnnotationRequestSchema,
  DeleteBookRequestSchema,
  DismissKeyPointRequestSchema,
  ExportBookNotesRequestSchema,
  GenerateBookInsightRequestSchema,
  UpdateBookAnnotationRequestSchema,
  type BookAnnotationListResponse,
  type BookDiscussionListResponse,
  type ExportBookNotesResponse,
} from '../../shared/api/index.ts';
import { BOOK_INSIGHT_KINDS, DEFAULT_NOTE_FOLDER, type BookInsightKind } from '../../shared/state.ts';
import { bookDiscussions, bookNotesMarkdown } from '../reading/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { liveBook } from './books.ts';
import { publishBookSpace, refreshBookOutlineMarks } from '../brain/index.ts';
import { annotationView, insightView } from './book-views.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function publish(context: RequestContext, bookId: string, part: 'annotations' | 'insights'): void {
  context.deps.hub.publish({ type: 'book_changed', bookId, part });
}

function insightKind(value: string): BookInsightKind {
  const found = BOOK_INSIGHT_KINDS.find((kind) => kind === value);
  if (found === undefined) {
    throw notFoundError('这一类归纳');
  }
  return found;
}

/** GET /v2/books/:id/annotations */
export function listBookAnnotations(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const body: BookAnnotationListResponse = { annotations: state.bookAnnotations.forBook(book.id).map(annotationView) };
  return { status: 200, body };
}

/** POST /v2/books/:id/annotations：带 keyPointId 时是收下 Plasticine 标的一条重点。 */
export async function createBookAnnotation(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(CreateBookAnnotationRequestSchema, await readJsonBody(context.req), '高亮');
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const chapter = book.toc[body.chapter];
  if (chapter === undefined || body.end > chapter.chars || body.start >= body.end) {
    throw new ApiError(400, 'invalid_request', '划的位置不在这一章里，请重新选中文字。', { field: 'start' });
  }
  return idempotent(context, body.requestId, () => {
    const created = state.bookAnnotations.create({
      bookId: book.id,
      chapter: body.chapter,
      start: body.start,
      end: body.end,
      quote: body.quote,
      prefix: body.prefix,
      suffix: body.suffix,
      color: body.color,
      note: body.note ?? null,
      origin: body.keyPointId === undefined && auth.actor !== 'system' ? 'user' : 'plasticine',
      deviceLabel: body.deviceLabel ?? null,
    });
    publish(context, book.id, 'annotations');
    refreshBookOutlineMarks(state, book);
    return { status: 201, body: annotationView(created) };
  });
}

/** PUT /v2/books/:id/annotations/:annotationId：换颜色、写或改批注。 */
export async function updateBookAnnotation(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(UpdateBookAnnotationRequestSchema, await readJsonBody(context.req), '改高亮');
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const annotation = state.bookAnnotations.get(param(context, 'annotationId'));
  if (annotation === undefined || annotation.bookId !== book.id || annotation.deletedAt !== null) {
    throw notFoundError('这条标注');
  }
  return idempotent(context, body.requestId, () => {
    const saved = state.bookAnnotations.update(annotation.id, body.version, {
      ...(body.color === undefined ? {} : { color: body.color }),
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    publish(context, book.id, 'annotations');
    refreshBookOutlineMarks(state, book);
    return { status: 200, body: annotationView(saved) };
  });
}

/** DELETE /v2/books/:id/annotations/:annotationId：只打删除时间。 */
export async function deleteBookAnnotation(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(DeleteBookRequestSchema, await readJsonBody(context.req), '删高亮');
  const { state, now } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const annotation = state.bookAnnotations.get(param(context, 'annotationId'));
  if (annotation === undefined || annotation.bookId !== book.id) {
    throw notFoundError('这条标注');
  }
  return idempotent(context, body.requestId, () => {
    if (annotation.deletedAt === null) {
      state.bookAnnotations.update(annotation.id, annotation.version, { deletedAt: now().toISOString() });
      publish(context, book.id, 'annotations');
      refreshBookOutlineMarks(state, book);
    }
    return { status: 200, body: { deleted: true } };
  });
}

/** GET /v2/books/:id/insights/:kind */
export function getBookInsight(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const kind = insightKind(param(context, 'kind'));
  const row = state.bookInsights.find(book.id, kind);
  const space = row === undefined ? null : publishBookSpace(state, book, row);
  return { status: 200, body: insightView(book, kind, row, space?.id ?? null) };
}

/** POST /v2/books/:id/insights：开始生成大纲或重点，马上返回「正在生成」，做完经事件流通知。 */
export async function generateBookInsight(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(GenerateBookInsightRequestSchema, await readJsonBody(context.req), '生成大纲或重点');
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    const row = context.deps.bookInsights.start(book, body.kind, body.force ?? false);
    publish(context, book.id, 'insights');
    const space = publishBookSpace(state, book, row);
    return { status: 202, body: insightView(book, body.kind, row, space?.id ?? null) };
  });
}

/** POST /v2/books/:id/insights/key_points/dismiss：「不要」这一条重点，原文里不再标它。 */
export async function dismissKeyPoint(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(DismissKeyPointRequestSchema, await readJsonBody(context.req), '不要这条重点');
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const row = state.bookInsights.find(book.id, 'key_points');
  if (row === undefined) {
    throw notFoundError('这本书的重点');
  }
  return idempotent(context, body.requestId, () => {
    const dismissed = row.dismissedPointIds.includes(body.pointId) ? row.dismissedPointIds
      : [...row.dismissedPointIds, body.pointId];
    const saved = state.bookInsights.update(row.id, row.version, { dismissedPointIds: dismissed });
    publish(context, book.id, 'insights');
    const space = publishBookSpace(state, book, saved, true);
    return { status: 200, body: insightView(book, 'key_points', saved, space?.id ?? null) };
  });
}

/** GET /v2/books/:id/discussions：主对话里引用过这本书的那几轮。 */
export function listBookDiscussions(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const body: BookDiscussionListResponse = { discussions: bookDiscussions(state, book.id) };
  return { status: 200, body };
}

/** POST /v2/books/:id/export：把现在的标注写成一篇新笔记；之后两边各管各的。 */
export async function exportBookNotes(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(ExportBookNotesRequestSchema, await readJsonBody(context.req), '导出成笔记');
  const { state, now } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const annotations = state.bookAnnotations.forBook(book.id);
  if (annotations.length === 0) {
    throw new ApiError(409, 'conflict', '这本书还没有高亮或批注，没有可导出的。', { next: '先在书里划几段再导出。' });
  }
  return idempotent(context, body.requestId, () => {
    const markdown = bookNotesMarkdown(book, annotations, now().toISOString());
    const note = state.notes.create({ markdown, folder: DEFAULT_NOTE_FOLDER,
      author: auth.actor === 'system' ? 'ai' : 'user' });
    context.deps.hub.publish({ type: 'note_invalidated', noteId: note.id });
    const reply: ExportBookNotesResponse = { noteId: note.id, annotationCount: annotations.length };
    return { status: 201, body: reply };
  });
}
