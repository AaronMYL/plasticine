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
  upload(input: UploadBookRequest, signal?: AbortSignal): Promise<UploadBookResponse>;
  /** GET /v2/books/:id */
  get(id: string, signal?: AbortSignal): Promise<BookView>;
  remove(id: string, requestId: string): Promise<void>;
  rename(id: string, input: RenameBookRequest): Promise<BookView>;
  restore(id: string, requestId: string): Promise<BookView>;
  /** GET /v2/books/:id/chapters/:index */
  chapter(id: string, index: number, signal?: AbortSignal): Promise<BookChapterResponse>;
  assetUrl(chapter: Pick<BookChapterResponse, 'assetBaseUrl'>, key: string): string;
  /** GET /v2/books/:id/search?q= */
  search(id: string, query: string, signal?: AbortSignal): Promise<BookSearchResponse>;
  saveProgress(id: string, input: SaveBookProgressRequest): Promise<BookProgressView>;
  /** GET /v2/books/:id/annotations */
  annotations(id: string, signal?: AbortSignal): Promise<BookAnnotationListResponse>;
  annotate(id: string, input: CreateBookAnnotationRequest): Promise<BookAnnotationView>;
  updateAnnotation(id: string, annotationId: string, input: UpdateBookAnnotationRequest): Promise<BookAnnotationView>;
  /** DELETE /v2/books/:id/annotations/:annotationId */
  removeAnnotation(id: string, annotationId: string, requestId: string): Promise<void>;
  /** GET /v2/books/:id/insights/:kind */
  insight(id: string, kind: BookInsightKind, signal?: AbortSignal): Promise<BookInsightView>;
  generateInsight(id: string, input: GenerateBookInsightRequest): Promise<BookInsightView>;
  dismissKeyPoint(id: string, input: DismissKeyPointRequest): Promise<BookInsightView>;
  discussions(id: string, signal?: AbortSignal): Promise<BookDiscussionListResponse>;
  exportNotes(id: string, requestId: string): Promise<ExportBookNotesResponse>;
}
