// /v2/books：图书馆、上传、读一章、封面和插图、在书里找、阅读进度、删书。标注、大纲重点、讨论在 book-notes.ts。

import { createHash } from 'node:crypto';
import {
  BOOK_UPLOAD_MAX_BYTES,
  DeleteBookRequestSchema,
  SaveBookProgressRequestSchema,
  UploadBookRequestSchema,
  type BookChapterResponse,
  type BookListResponse,
  type BookProgressView,
  type BookSearchResponse,
  type UploadBookResponse,
} from '../../shared/api/index.ts';
import { BookParseError } from '../books/index.ts';
import { importBook, searchBook } from '../reading/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import type { BookRecord } from '../../shared/state.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { bookAssetUrl, bookView } from './book-views.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

// base64 比原文件大三分之一，再留一点给 JSON 的其他字段。
const UPLOAD_BODY_BYTES = Math.ceil((BOOK_UPLOAD_MAX_BYTES * 4) / 3) + 8192;
const PARSE_ERROR_STATUS: Readonly<Record<BookParseError['code'], number>> = {
  drm: 422,
  unsupported: 415,
  corrupt: 422,
  empty: 422,
  too_large: 413,
};

export function liveBook(state: StateService, id: string): BookRecord {
  const book = state.books.get(id);
  if (book === undefined || book.deletedAt !== null) {
    throw notFoundError('这本书');
  }
  return book;
}

function publishBook(context: RequestContext, bookId: string, part: 'book' | 'progress'): void {
  context.deps.hub.publish({ type: 'book_changed', bookId, part });
}

/** GET /v2/books */
export function listBooks(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const body: BookListResponse = { books: state.books.live().map((book) => bookView(state, book)) };
  return { status: 200, body };
}

/** GET /v2/books/:id */
export function getBook(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  return { status: 200, body: bookView(state, liveBook(state, param(context, 'id'))) };
}

/** POST /v2/books：同一个文件再传一次不新建，回原来那本。 */
export async function uploadBook(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(UploadBookRequestSchema, await readJsonBody(context.req, UPLOAD_BODY_BYTES), '上传的书');
  const bytes = Buffer.from(body.content, 'base64');
  if (bytes.length !== body.bytes || createHash('sha256').update(bytes).digest('hex') !== body.sha256) {
    throw new ApiError(400, 'invalid_request', '书的大小或摘要对不上，传的过程中可能断了。请重新选择文件上传。');
  }
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    let imported;
    try {
      imported = importBook(state, { fileName: body.fileName, bytes });
    } catch (error) {
      if (error instanceof BookParseError) {
        throw new ApiError(PARSE_ERROR_STATUS[error.code], error.code === 'too_large' ? 'too_large'
          : 'unsupported_type', error.message, { field: 'content' });
      }
      throw error;
    }
    if (!imported.duplicate) {
      publishBook(context, imported.book.id, 'book');
    }
    const reply: UploadBookResponse = { book: bookView(state, imported.book), duplicate: imported.duplicate };
    return { status: imported.duplicate ? 200 : 201, body: reply };
  });
}

/** DELETE /v2/books/:id：只打删除时间，原文件和标注都留着。 */
export async function deleteBook(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(DeleteBookRequestSchema, await readJsonBody(context.req), '删除书');
  const { state, now } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    state.books.update(book.id, book.version, { deletedAt: now().toISOString() });
    publishBook(context, book.id, 'book');
    return { status: 200, body: { deleted: true } };
  });
}

/** GET /v2/books/:id/chapters/:index：打开时顺手记下「最近打开」，图书馆按它排。 */
export function getBookChapter(context: RequestContext): Reply {
  requireAuth(context);
  const { state, now } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const index = Number(param(context, 'index'));
  if (!Number.isInteger(index) || index < 0 || index >= book.toc.length) {
    throw new ApiError(404, 'not_found', `这本书没有第 ${index + 1} 章。`, { field: 'index' });
  }
  const chapter = state.bookFiles.chapter(book.id, index);
  state.books.update(book.id, book.version, { lastOpenedAt: now().toISOString() });
  const body: BookChapterResponse = {
    bookId: book.id,
    index,
    title: chapter.title,
    html: chapter.html,
    chars: chapter.text.length,
    assetBaseUrl: bookAssetUrl(book.id, ''),
  };
  return { status: 200, body };
}

/** GET /v2/books/:id/assets/:key：封面和插图。 */
export function getBookAsset(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  try {
    return { status: 200, bytes: state.bookFiles.asset(book.id, param(context, 'key')) };
  } catch (error) {
    if (error instanceof StateError && error.code === 'not_found') {
      throw notFoundError('这张图');
    }
    throw error;
  }
}

/** GET /v2/books/:id/search?q= */
export function searchInBook(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const query = context.url.searchParams.get('q') ?? '';
  if (query.trim() === '' || query.length > 200) {
    throw new ApiError(400, 'invalid_request', '要找的字写 1 到 200 个字。', { field: 'q' });
  }
  const body: BookSearchResponse = searchBook(state.bookFiles.content(book.id).chapters, query);
  return { status: 200, body };
}

/**
 * PUT /v2/books/:id/progress：后写的为准。两台设备前后脚翻页时不报冲突（进度不是要合并的内容），
 * 而是按当前版本覆盖；另一台下次打开时看到「iPhone 上读到第 7 章」。
 */
export async function saveBookProgress(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SaveBookProgressRequestSchema, await readJsonBody(context.req), '阅读进度');
  const { state } = context.deps;
  const book = liveBook(state, param(context, 'id'));
  const chapterChars = book.toc[body.chapter]?.chars;
  if (chapterChars === undefined) {
    throw new ApiError(400, 'invalid_request', `这本书没有第 ${body.chapter + 1} 章。`, { field: 'chapter' });
  }
  const input = { bookId: book.id, chapter: body.chapter, offset: Math.min(body.offset, chapterChars),
    percent: body.percent, deviceLabel: body.deviceLabel };
  const current = state.bookProgress.get(book.id);
  const saved = state.bookProgress.save(input, current?.version ?? null);
  publishBook(context, book.id, 'progress');
  const reply: BookProgressView = {
    chapter: saved.chapter,
    offset: saved.offset,
    percent: saved.percent,
    deviceLabel: saved.deviceLabel,
    updatedAt: saved.updatedAt,
    version: saved.version,
  };
  return { status: 200, body: reply };
}
