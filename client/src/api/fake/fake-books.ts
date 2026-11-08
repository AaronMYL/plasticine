// 假的图书馆：书、章节、进度、标注、Plasticine 的大纲和重点都在内存里。写操作按 requestId 幂等，标注带版本保护，
// 删除只记时间；415 / 422 / 413 的文案照真服务端的口径写。大纲和重点「后台生成」：先回 generating，过一会儿推
// book.changed{part:'insights'}，和真服务端的 202 + 事件一样。

import type { BooksApi } from '../books-client.ts';
import { ApiError } from '../errors.ts';
import { splitQuotes } from '../quote-text.ts';
import {
  BOOK_FILE_EXTENSIONS,
  BOOK_SEARCH_MAX_HITS,
  BOOK_UPLOAD_MAX_BYTES,
  BOOKS_PATH,
  type BookAnnotationView,
  type BookChapterResponse,
  type BookDiscussion,
  type BookFormat,
  type BookInsightKind,
  type BookInsightView,
  type BookProgressView,
  type BookQuoteReference,
  type BookSearchHit,
  type BookView,
  type CreateBookAnnotationRequest,
  type DismissKeyPointRequest,
  type ExportBookNotesResponse,
  type GenerateBookInsightRequest,
  type RenameBookRequest,
  type ResolvedConversationQuote,
  type SaveBookProgressRequest,
  type UpdateBookAnnotationRequest,
  type UploadBookRequest,
  type UploadBookResponse,
} from '../shared.ts';
import type { BookChangedPart } from '../types.ts';
import type { LineMessageView } from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeSession } from './fake-session.ts';
import { generatedInsight, type InsightRow } from './fake-book-insights.ts';
import { chapterOf, plainChapters, type FakeChapter } from './fake-book-text.ts';

export interface FakeBooksDeps {
  session: FakeSession;
  bus: FakeEventBus;
  notes: FakeNotes;
  now: () => Date;
  /** 主对话里的消息：「讨论」从引用过这本书的那几轮里拼出来。 */
  /** 主线的消息（引用过这本书的那几句就是「讨论」）。 */
  messages: () => LineMessageView[];
  /** 上传和生成大纲各等多久才完成；测试用 0，本地开发给一点时间看「正在导入」「正在逐章归纳」。 */
  workMs: number;
}

interface FakeBook {
  view: BookView;
  chapters: FakeChapter[];
  sha256: string;
  deletedAt: string | null;
}

// 命中处前后各带多少字给界面看（真服务端是 reading/search.ts 的口径，这里取一样的量级）。
const SEARCH_CONTEXT_CHARS = 24;

function invalid(status: number, code: string, message: string): ApiError {
  return new ApiError({ kind: status === 404 ? 'not_found' : 'invalid', code, status, message });
}

function formatOf(fileName: string): BookFormat | null {
  const lower = fileName.toLowerCase();
  const extension = BOOK_FILE_EXTENSIONS.find((suffix) => lower.endsWith(suffix));
  if (extension === undefined) {
    return null;
  }
  return extension === '.azw' ? 'azw3' : extension.slice(1) as BookFormat;
}

function decodeText(content: string): string {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export class FakeBooks implements BooksApi {
  private readonly books = new Map<string, FakeBook>();
  private readonly annotationRows = new Map<string, BookAnnotationView>();
  private readonly insights = new Map<string, InsightRow>();
  /** 预置过的大纲 / 重点：「重新生成」时照它再出一份，本地开发看到的还是那几条。 */
  private readonly templates = new Map<string, InsightRow>();
  private readonly results = new Map<string, unknown>();
  private readonly deps: FakeBooksDeps;
  private sequence = 0;
  private nextInsightError: string | null = null;

  constructor(deps: FakeBooksDeps) {
    this.deps = deps;
  }

  // ---------- 预置与测试控制 ----------

  seedBook(book: Omit<BookView, 'charCount' | 'annotationCount' | 'toc' | 'version'>, chapters: FakeChapter[]): void {
    const toc = chapters.map((chapter) => ({ title: chapter.title, chars: chapter.text.length }));
    const charCount = toc.reduce((sum, entry) => sum + entry.chars, 0);
    this.books.set(book.id, { view: { ...book, toc, charCount, annotationCount: 0, version: 1 }, chapters,
      sha256: book.id.padEnd(64, '0').slice(0, 64), deletedAt: null });
  }

  seedAnnotation(annotation: BookAnnotationView): void {
    this.annotationRows.set(annotation.id, annotation);
  }

  seedInsight(bookId: string, row: InsightRow): void {
    this.insights.set(`${bookId}:${row.kind}`, row);
    this.templates.set(`${bookId}:${row.kind}`, row);
  }

  /** 下一次生成大纲或重点失败，带这句服务端错误（测「生成失败」那一态）。 */
  failNextInsight(message: string): void {
    this.nextInsightError = message;
  }

  chapterText(bookId: string, index: number): string {
    return chapterOf(this.require(bookId).chapters, index).text;
  }

  /** 对话引用一段书：和真服务端一样按位置重取原文，对不上就不发。 */
  resolveQuote(reference: BookQuoteReference): ResolvedConversationQuote {
    const book = this.books.get(reference.bookId);
    if (book === undefined || book.deletedAt !== null) {
      throw new ApiError({ kind: 'conflict', code: 'book_quote_unavailable', status: 409,
        message: '引用的书不在图书馆里了，这条消息没有发送。', next: '请把消息放回输入框，移除这个引用后再发。' });
    }
    const chapter = book.chapters[reference.chapter];
    if (chapter?.text.slice(reference.start, reference.end) !== reference.text) {
      throw new ApiError({ kind: 'conflict', code: 'book_quote_changed', status: 409,
        message: '引用的那段和书里现在的原文对不上，这条消息没有发送。', next: '请回到书里重新选中这段，再引用到对话。' });
    }
    return { label: `《${book.view.title}》 ${chapter.title}`, text: reference.text, bookReference: reference };
  }

  /** 假查找用：在架上的书（书名、作者）。 */
  searchable(): { id: string; updatedAt: string; title: string; text: string }[] {
    return [...this.books.values()].filter((book) => book.deletedAt === null).map((book) => ({ id: book.view.id,
      updatedAt: book.view.updatedAt, title: book.view.title, text: book.view.author ?? '' }));
  }

  // ---------- 接口 ----------

  async list(): Promise<{ books: BookView[] }> {
    this.deps.session.require();
    const live = [...this.books.values()].filter((book) => book.deletedAt === null);
    return { books: live.map((book) => this.viewOf(book)) };
  }

  async upload(input: UploadBookRequest): Promise<UploadBookResponse> {
    this.deps.session.require();
    const replay = this.results.get(input.requestId);
    if (replay !== undefined) {
      return structuredClone(replay as UploadBookResponse);
    }
    if (this.deps.workMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.deps.workMs));
    }
    const response = this.importFile(input);
    this.results.set(input.requestId, response);
    if (!response.duplicate) {
      this.emit(response.book.id, 'book');
    }
    return structuredClone(response);
  }

  async get(id: string): Promise<BookView> {
    this.deps.session.require();
    return this.viewOf(this.require(id));
  }

  /** 「最近删除」里的书（假 GET /v2/library/trash 用）。 */
  deletedRows(): { id: string; title: string; deletedAt: string }[] {
    return [...this.books.values()].flatMap((book) => (book.deletedAt === null ? []
      : [{ id: book.view.id, title: book.view.title, deletedAt: book.deletedAt }]));
  }

  async rename(id: string, input: RenameBookRequest): Promise<BookView> {
    this.deps.session.require();
    const book = this.require(id);
    const title = input.title.trim();
    if (title === '') {
      throw invalid(400, 'invalid_request', '书名不能是空的。');
    }
    if (!this.results.has(input.requestId)) {
      book.view = { ...book.view, title, version: book.view.version + 1 };
      this.results.set(input.requestId, true);
      this.emit(id, 'book');
    }
    return this.viewOf(book);
  }

  async restore(id: string, requestId: string): Promise<BookView> {
    this.deps.session.require();
    const book = this.books.get(id);
    if (book === undefined) {
      throw invalid(404, 'not_found', '这本书不在了。');
    }
    if (!this.results.has(requestId)) {
      book.deletedAt = null;
      this.results.set(requestId, true);
      this.emit(id, 'book');
    }
    return this.viewOf(book);
  }

  async remove(id: string, requestId: string): Promise<void> {
    this.deps.session.require();
    if (this.results.has(requestId)) {
      return;
    }
    const book = this.require(id);
    book.deletedAt = this.deps.now().toISOString();
    this.results.set(requestId, true);
    this.emit(id, 'book');
  }

  async chapter(id: string, index: number): Promise<BookChapterResponse> {
    this.deps.session.require();
    const book = this.require(id);
    const chapter = book.chapters[index];
    if (chapter === undefined) {
      throw invalid(404, 'not_found', `这本书没有第 ${index + 1} 章。`);
    }
    book.view = { ...book.view, lastOpenedAt: this.deps.now().toISOString() };
    return { bookId: id, index, title: chapter.title, html: chapter.html, chars: chapter.text.length,
      assetBaseUrl: `${BOOKS_PATH}/${encodeURIComponent(id)}/assets/` };
  }

  assetUrl(chapter: Pick<BookChapterResponse, 'assetBaseUrl'>, key: string): string {
    return `${chapter.assetBaseUrl}${encodeURIComponent(key)}`;
  }

  async search(id: string, query: string): Promise<{ hits: BookSearchHit[]; truncated: boolean }> {
    this.deps.session.require();
    const needle = query.trim().toLocaleLowerCase();
    if (needle === '' || query.length > 200) {
      throw invalid(400, 'invalid_request', '要找的字写 1 到 200 个字。');
    }
    const hits: BookSearchHit[] = [];
    let truncated = false;
    this.require(id).chapters.forEach((chapter, index) => {
      const haystack = chapter.text.toLocaleLowerCase();
      let at = haystack.indexOf(needle);
      while (at >= 0) {
        if (hits.length >= BOOK_SEARCH_MAX_HITS) {
          truncated = true;
          return;
        }
        const end = at + needle.length;
        hits.push({ chapter: index, chapterTitle: chapter.title, start: at, end,
          before: chapter.text.slice(Math.max(0, at - SEARCH_CONTEXT_CHARS), at), match: chapter.text.slice(at, end),
          after: chapter.text.slice(end, end + SEARCH_CONTEXT_CHARS) });
        at = haystack.indexOf(needle, end);
      }
    });
    return { hits, truncated };
  }

  async saveProgress(id: string, input: SaveBookProgressRequest): Promise<BookProgressView> {
    this.deps.session.require();
    const book = this.require(id);
    const chapter = book.chapters[input.chapter];
    if (chapter === undefined) {
      throw invalid(400, 'invalid_request', `这本书没有第 ${input.chapter + 1} 章。`);
    }
    const progress: BookProgressView = { chapter: input.chapter, offset: Math.min(input.offset, chapter.text.length),
      percent: input.percent, deviceLabel: input.deviceLabel, updatedAt: this.deps.now().toISOString(),
      version: (book.view.progress?.version ?? 0) + 1 };
    book.view = { ...book.view, progress };
    this.emit(id, 'progress');
    return structuredClone(progress);
  }

  async annotations(id: string): Promise<{ annotations: BookAnnotationView[] }> {
    this.deps.session.require();
    this.require(id);
    return { annotations: structuredClone(this.liveAnnotations(id)) };
  }

  async annotate(id: string, input: CreateBookAnnotationRequest): Promise<BookAnnotationView> {
    this.deps.session.require();
    const replay = this.results.get(input.requestId);
    if (replay !== undefined) {
      return structuredClone(replay as BookAnnotationView);
    }
    const chapter = this.require(id).chapters[input.chapter];
    if (chapter === undefined || input.end > chapter.text.length || input.start >= input.end) {
      throw invalid(400, 'invalid_request', '划的位置不在这一章里，请重新选中文字。');
    }
    this.sequence += 1;
    const at = this.deps.now().toISOString();
    const created: BookAnnotationView = { id: `ann_${String(this.sequence).padStart(4, '0')}`, bookId: id,
      chapter: input.chapter, start: input.start, end: input.end, quote: input.quote, prefix: input.prefix,
      suffix: input.suffix, color: input.color, note: input.note ?? null,
      origin: input.keyPointId === undefined ? 'user' : 'plasticine', deviceLabel: input.deviceLabel ?? null,
      createdAt: at, updatedAt: at, version: 1 };
    this.annotationRows.set(created.id, created);
    this.results.set(input.requestId, created);
    this.emit(id, 'annotations');
    return structuredClone(created);
  }

  async updateAnnotation(id: string, annotationId: string,
    input: UpdateBookAnnotationRequest): Promise<BookAnnotationView> {
    this.deps.session.require();
    const replay = this.results.get(input.requestId);
    if (replay !== undefined) {
      return structuredClone(replay as BookAnnotationView);
    }
    const current = this.requireAnnotation(id, annotationId);
    if (current.version !== input.version) {
      throw new ApiError({ kind: 'conflict', code: 'version_conflict', status: 409,
        message: '这条标注在别处改过了。', next: '关掉再打开这本书，看看现在的样子。' });
    }
    const saved: BookAnnotationView = { ...current, ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.note === undefined ? {} : { note: input.note }), updatedAt: this.deps.now().toISOString(),
      version: current.version + 1 };
    this.annotationRows.set(annotationId, saved);
    this.results.set(input.requestId, saved);
    this.emit(id, 'annotations');
    return structuredClone(saved);
  }

  async removeAnnotation(id: string, annotationId: string, requestId: string): Promise<void> {
    this.deps.session.require();
    if (this.results.has(requestId)) {
      return;
    }
    this.requireAnnotation(id, annotationId);
    this.annotationRows.delete(annotationId);
    this.results.set(requestId, true);
    this.emit(id, 'annotations');
  }

  async insight(id: string, kind: BookInsightKind): Promise<BookInsightView> {
    this.deps.session.require();
    this.require(id);
    return this.insightView(kind, this.insights.get(`${id}:${kind}`));
  }

  async generateInsight(id: string, input: GenerateBookInsightRequest): Promise<BookInsightView> {
    this.deps.session.require();
    const book = this.require(id);
    const key = `${id}:${input.kind}`;
    const current = this.insights.get(key);
    if (current?.status === 'generating' || current?.status === 'ready' && input.force !== true) {
      return this.insightView(input.kind, current);
    }
    const generating: InsightRow = { kind: input.kind, status: 'generating', outline: current?.outline ?? null,
      keyPoints: current?.keyPoints ?? null, dismissedPointIds: current?.dismissedPointIds ?? [], error: null,
      generatedAt: current?.generatedAt ?? null };
    this.insights.set(key, generating);
    this.emit(id, 'insights');
    const finish = (): void => {
      const error = this.nextInsightError;
      this.nextInsightError = null;
      const at = this.deps.now().toISOString();
      const template = this.templates.get(key);
      const ready = template === undefined ? generatedInsight(input.kind, plainChapters(book.chapters), at)
        : { ...template, generatedAt: at, dismissedPointIds: [] };
      this.insights.set(key, error === null ? ready : { ...generating, status: 'failed', error });
      this.emit(id, 'insights');
    };
    setTimeout(finish, this.deps.workMs);
    return this.insightView(input.kind, generating);
  }

  async dismissKeyPoint(id: string, input: DismissKeyPointRequest): Promise<BookInsightView> {
    this.deps.session.require();
    this.require(id);
    const key = `${id}:key_points`;
    const current = this.insights.get(key);
    if (current === undefined) {
      throw invalid(404, 'not_found', '这本书还没有 Plasticine 标的重点。');
    }
    if (!current.dismissedPointIds.includes(input.pointId)) {
      this.insights.set(key, { ...current, dismissedPointIds: [...current.dismissedPointIds, input.pointId] });
      this.emit(id, 'insights');
    }
    return this.insightView('key_points', this.insights.get(key));
  }

  async discussions(id: string): Promise<{ discussions: BookDiscussion[] }> {
    this.deps.session.require();
    this.require(id);
    const messages = this.deps.messages().sort((a, b) => a.seq - b.seq);
    const discussions: BookDiscussion[] = [];
    const refOf = (message: LineMessageView): string => `line:${message.lineId}:${message.seq}`;
    messages.forEach((message, index) => {
      if (message.role !== 'user') {
        return;
      }
      const { quotes, text } = splitQuotes(message.text, refOf(message));
      const quote = quotes.find((chip) => chip.bookReference?.bookId === id);
      if (quote?.bookReference === undefined) {
        return;
      }
      const answer = messages.slice(index + 1).find((next) => next.role === 'assistant' && next.text.trim() !== '');
      discussions.push({ messageId: refOf(message), at: message.createdAt, question: text, quoteLabel: quote.label,
        chapter: quote.bookReference.chapter, start: quote.bookReference.start,
        answer: answer === undefined ? null : answer.text,
        answerMessageId: answer === undefined ? null : refOf(answer) });
    });
    return { discussions: discussions.reverse() };
  }

  async exportNotes(id: string, requestId: string): Promise<ExportBookNotesResponse> {
    this.deps.session.require();
    const replay = this.results.get(requestId);
    if (replay !== undefined) {
      return structuredClone(replay as ExportBookNotesResponse);
    }
    const book = this.require(id);
    const rows = this.liveAnnotations(id);
    const sections = book.chapters.flatMap((chapter, index) => {
      const inChapter = rows.filter((row) => row.chapter === index);
      return inChapter.length === 0 ? [] : [`## ${chapter.title}`, ...inChapter.flatMap((row) =>
        [`> ${row.quote}`, ...row.note === null ? [] : [row.note]])];
    });
    const note = await this.deps.notes.create({ requestId,
      markdown: [`# 《${book.view.title}》的标注`, ...sections].join('\n\n') });
    const response = { noteId: note.id, annotationCount: rows.length };
    this.results.set(requestId, response);
    return response;
  }

  // ---------- 内部 ----------

  private importFile(input: UploadBookRequest): UploadBookResponse {
    const format = formatOf(input.fileName);
    if (format === null) {
      throw invalid(415, 'unsupported_type', '这个格式打不开：图书只认 EPUB、TXT、MOBI、AZW3。');
    }
    if (input.bytes > BOOK_UPLOAD_MAX_BYTES) {
      throw invalid(413, 'too_large', '这本书超过 100 MB，导入不了。请换一个小一些的版本。');
    }
    if (input.fileName.toLowerCase().includes('drm')) {
      throw invalid(422, 'unsupported_type', '这本书带 DRM 加密，打不开。请换一个没有加密的版本。');
    }
    const existing = [...this.books.values()].find((book) => book.sha256 === input.sha256 && book.deletedAt === null);
    if (existing !== undefined) {
      return { book: this.viewOf(existing), duplicate: true };
    }
    // 删过的同一个文件：还原那本（标注跟着回来），和服务端一样。
    const deleted = [...this.books.values()].find((book) => book.sha256 === input.sha256 && book.deletedAt !== null);
    if (deleted !== undefined) {
      deleted.deletedAt = null;
      this.emit(deleted.view.id, 'book');
      return { book: this.viewOf(deleted), duplicate: true };
    }
    const title = input.fileName.replace(/\.[^.]+$/, '');
    const paragraphs = format === 'txt' ? decodeText(input.content).split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line !== '') : ['（本地假接口没有解析这个文件；接上真服务端后会读出目录和正文。）'];
    if (paragraphs.length === 0) {
      throw invalid(422, 'unsupported_type', '这个文件里没有读到文字。');
    }
    this.sequence += 1;
    const id = `book_${String(this.sequence).padStart(4, '0')}`;
    const at = this.deps.now().toISOString();
    this.seedBook({ id, title, author: null, format, fileName: input.fileName, sourceBytes: input.bytes,
      coverUrl: null, progress: null, createdAt: at, updatedAt: at, lastOpenedAt: null },
    [chapterOf([{ title: '正文', paragraphs }], 0)]);
    const book = this.require(id);
    book.sha256 = input.sha256;
    return { book: this.viewOf(book), duplicate: false };
  }

  private liveAnnotations(bookId: string): BookAnnotationView[] {
    return [...this.annotationRows.values()].filter((row) => row.bookId === bookId)
      .sort((a, b) => a.chapter - b.chapter || a.start - b.start);
  }

  private insightView(kind: BookInsightKind, row: InsightRow | undefined): BookInsightView {
    if (row === undefined) {
      return { kind, status: 'none', outline: null, keyPoints: null, dismissedPointIds: [], error: null,
        generatedAt: null, stale: false };
    }
    return structuredClone({ ...row, stale: false });
  }

  private viewOf(book: FakeBook): BookView {
    return structuredClone({ ...book.view, annotationCount: this.liveAnnotations(book.view.id).length });
  }

  private require(id: string): FakeBook {
    const book = this.books.get(id);
    if (book === undefined || book.deletedAt !== null) {
      throw invalid(404, 'not_found', '这本书不在图书馆里了。');
    }
    return book;
  }

  private requireAnnotation(bookId: string, annotationId: string): BookAnnotationView {
    const row = this.annotationRows.get(annotationId);
    if (row === undefined || row.bookId !== bookId) {
      throw invalid(404, 'not_found', '这条标注已经不在了。');
    }
    return row;
  }

  private emit(bookId: string, part: BookChangedPart): void {
    this.deps.bus.emit({ type: 'book.changed', bookId, part });
  }
}
