// /v2/books 的真实现：每个方法一次请求，回答先过 shared/api/books.ts 的 schema。
// 上传、标注这些写操作没拿到回答算「结果待核实」（同一 requestId 重发不会做两次）；读操作没拿到回答算失败。

import { Type } from 'typebox';
import type { BooksApi } from '../books-client.ts';
import {
  BOOKS_PATH,
  BookAnnotationListResponseSchema,
  BookAnnotationViewSchema,
  BookChapterResponseSchema,
  BookDiscussionListResponseSchema,
  BookInsightViewSchema,
  BookListResponseSchema,
  BookProgressViewSchema,
  BookSearchResponseSchema,
  BookViewSchema,
  ExportBookNotesResponseSchema,
  UploadBookResponseSchema,
  type BookChapterResponse,
  type BookInsightKind,
  type CreateBookAnnotationRequest,
  type DismissKeyPointRequest,
  type GenerateBookInsightRequest,
  type SaveBookProgressRequest,
  type UpdateBookAnnotationRequest,
  type UploadBookRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

/**
 * 上传一本书最多等 5 分钟：书最大 100 MB，JSON 里的 base64 再大三分之一；手机上传按 3 Mbps 估算约 4 分半。
 * 超时算「结果待核实」，同一 requestId 重传服务端回原来那本，不会多出一本。
 */
export const BOOK_UPLOAD_TIMEOUT_MS = 300_000;

// 删书、删标注的回答是 {deleted:true}；shared/api/books.ts 没有给这个回答导出 schema（见交付说明里的接口缺口），
// 这里只校验这一个字段，不把它当成接口类型往外用。
const DeletedSchema = Type.Object({ deleted: Type.Boolean() });

function bookPath(id: string): string {
  return `${BOOKS_PATH}/${encodeURIComponent(id)}`;
}

export class HttpBooks implements BooksApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: BOOKS_PATH, schema: BookListResponseSchema,
      what: '读图书馆', lostAs: 'failed', signal });
  }

  upload(input: UploadBookRequest, signal?: AbortSignal) {
    return this.transport.request({ method: 'POST', path: BOOKS_PATH, body: input, schema: UploadBookResponseSchema,
      what: '导入书', lostAs: 'uncertain', timeoutMs: BOOK_UPLOAD_TIMEOUT_MS, signal });
  }

  get(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: bookPath(id), schema: BookViewSchema,
      what: '读这本书', lostAs: 'failed', signal });
  }

  async remove(id: string, requestId: string): Promise<void> {
    await this.transport.request({ method: 'DELETE', path: bookPath(id), body: { requestId },
      schema: DeletedSchema, what: '删书', lostAs: 'uncertain' });
  }

  chapter(id: string, index: number, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${bookPath(id)}/chapters/${index}`,
      schema: BookChapterResponseSchema, what: '读这一章', lostAs: 'failed', signal });
  }

  assetUrl(chapter: Pick<BookChapterResponse, 'assetBaseUrl'>, key: string): string {
    return `${chapter.assetBaseUrl}${encodeURIComponent(key)}`;
  }

  search(id: string, query: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${bookPath(id)}/search`, query: { q: query },
      schema: BookSearchResponseSchema, what: '在书里找', lostAs: 'failed', signal });
  }

  saveProgress(id: string, input: SaveBookProgressRequest) {
    return this.transport.request({ method: 'PUT', path: `${bookPath(id)}/progress`, body: input,
      schema: BookProgressViewSchema, what: '记阅读进度', lostAs: 'uncertain' });
  }

  annotations(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${bookPath(id)}/annotations`,
      schema: BookAnnotationListResponseSchema, what: '读标注', lostAs: 'failed', signal });
  }

  annotate(id: string, input: CreateBookAnnotationRequest) {
    return this.transport.request({ method: 'POST', path: `${bookPath(id)}/annotations`, body: input,
      schema: BookAnnotationViewSchema, what: '高亮', lostAs: 'uncertain' });
  }

  updateAnnotation(id: string, annotationId: string, input: UpdateBookAnnotationRequest) {
    return this.transport.request({ method: 'PUT',
      path: `${bookPath(id)}/annotations/${encodeURIComponent(annotationId)}`, body: input,
      schema: BookAnnotationViewSchema, what: '改高亮', lostAs: 'uncertain' });
  }

  async removeAnnotation(id: string, annotationId: string, requestId: string): Promise<void> {
    await this.transport.request({ method: 'DELETE',
      path: `${bookPath(id)}/annotations/${encodeURIComponent(annotationId)}`, body: { requestId },
      schema: DeletedSchema, what: '删高亮', lostAs: 'uncertain' });
  }

  insight(id: string, kind: BookInsightKind, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${bookPath(id)}/insights/${kind}`,
      schema: BookInsightViewSchema, what: kind === 'outline' ? '读大纲' : '读重点', lostAs: 'failed', signal });
  }

  generateInsight(id: string, input: GenerateBookInsightRequest) {
    return this.transport.request({ method: 'POST', path: `${bookPath(id)}/insights`, body: input,
      schema: BookInsightViewSchema, what: input.kind === 'outline' ? '生成大纲' : '生成重点', lostAs: 'uncertain' });
  }

  dismissKeyPoint(id: string, input: DismissKeyPointRequest) {
    return this.transport.request({ method: 'POST', path: `${bookPath(id)}/insights/key_points/dismiss`, body: input,
      schema: BookInsightViewSchema, what: '不要这条重点', lostAs: 'uncertain' });
  }

  discussions(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${bookPath(id)}/discussions`,
      schema: BookDiscussionListResponseSchema, what: '读这本书的讨论', lostAs: 'failed', signal });
  }

  exportNotes(id: string, requestId: string) {
    return this.transport.request({ method: 'POST', path: `${bookPath(id)}/export`, body: { requestId },
      schema: ExportBookNotesResponseSchema, what: '导出成笔记', lostAs: 'uncertain' });
  }
}
