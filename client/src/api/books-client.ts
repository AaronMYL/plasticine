// 图书接口（/v2/books）的客户端签名：http/books.ts 的真实现和 fake/fake-books.ts 的内存实现都满足它。
// 请求和回答的形状都是 agent/shared/api/books.ts 里的，这里不另写一份。

import type {
  BookAnnotationListResponse,
  BookAnnotationView,
  BookChapterResponse,
  BookDiscussionListResponse,
  BookInsightKind,
  BookInsightView,
  BookListResponse,
  BookProgressView,
  BookSearchResponse,
  BookView,
  CreateBookAnnotationRequest,
  DismissKeyPointRequest,
  ExportBookNotesResponse,
  GenerateBookInsightRequest,
  RenameBookRequest,
  SaveBookProgressRequest,
  UpdateBookAnnotationRequest,
  UploadBookRequest,
  UploadBookResponse,
} from './shared.ts';

export interface BooksApi {
  /** GET /v2/books */
  list(signal?: AbortSignal): Promise<BookListResponse>;
  /** POST /v2/books：同一个文件再传一次回原来那本（duplicate=true）；415 / 422 / 413 的文案用服务端的。 */
  upload(input: UploadBookRequest, signal?: AbortSignal): Promise<UploadBookResponse>;
  /** GET /v2/books/:id */
  get(id: string, signal?: AbortSignal): Promise<BookView>;
  /** DELETE /v2/books/:id：只打删除时间，原文件和标注都留着；进资料库「最近删除」。 */
  remove(id: string, requestId: string): Promise<void>;
  /** PATCH /v2/books/:id：改书名。 */
  rename(id: string, input: RenameBookRequest): Promise<BookView>;
  /** POST /v2/books/:id/restore：从「最近删除」还原。 */
  restore(id: string, requestId: string): Promise<BookView>;
  /** GET /v2/books/:id/chapters/:index */
  chapter(id: string, index: number, signal?: AbortSignal): Promise<BookChapterResponse>;
  /** 封面、插图的地址：chapter 回答里的 assetBaseUrl 加 encodeURIComponent(key)。 */
  assetUrl(chapter: Pick<BookChapterResponse, 'assetBaseUrl'>, key: string): string;
  /** GET /v2/books/:id/search?q= */
  search(id: string, query: string, signal?: AbortSignal): Promise<BookSearchResponse>;
  /** PUT /v2/books/:id/progress：后写的为准，不报冲突。 */
  saveProgress(id: string, input: SaveBookProgressRequest): Promise<BookProgressView>;
  /** GET /v2/books/:id/annotations */
  annotations(id: string, signal?: AbortSignal): Promise<BookAnnotationListResponse>;
  /** POST /v2/books/:id/annotations：带 keyPointId 时是收下 Plasticine 标的一条重点。 */
  annotate(id: string, input: CreateBookAnnotationRequest): Promise<BookAnnotationView>;
  /** PUT /v2/books/:id/annotations/:annotationId：换颜色、写或改批注（带 version）。 */
  updateAnnotation(id: string, annotationId: string, input: UpdateBookAnnotationRequest): Promise<BookAnnotationView>;
  /** DELETE /v2/books/:id/annotations/:annotationId */
  removeAnnotation(id: string, annotationId: string, requestId: string): Promise<void>;
  /** GET /v2/books/:id/insights/:kind */
  insight(id: string, kind: BookInsightKind, signal?: AbortSignal): Promise<BookInsightView>;
  /** POST /v2/books/:id/insights：202，后台生成，做完经事件流 book_changed{part:'insights'} 通知。 */
  generateInsight(id: string, input: GenerateBookInsightRequest): Promise<BookInsightView>;
  /** POST /v2/books/:id/insights/key_points/dismiss：「不要」这一条重点。 */
  dismissKeyPoint(id: string, input: DismissKeyPointRequest): Promise<BookInsightView>;
  /** GET /v2/books/:id/discussions：主对话里引用过这本书的几轮。 */
  discussions(id: string, signal?: AbortSignal): Promise<BookDiscussionListResponse>;
  /** POST /v2/books/:id/export：把标注导出成一篇笔记。 */
  exportNotes(id: string, requestId: string): Promise<ExportBookNotesResponse>;
}
