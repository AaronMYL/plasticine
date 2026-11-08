// 阅读页上对标注的几种写操作：划高亮、写批注、换颜色、删、收下 / 不要 Plasticine 标的重点。
// 每次带新的 requestId；成功后重读标注（事件流也会来，重读一次无妨）。失败把服务端那句中文交给界面，不吞。

import type { BooksApi } from '../../api/books-client.ts';
import type { BookAnchor, BookAnnotationView, CreateBookAnnotationRequest,
  HighlightColor } from '../../api/shared.ts';
import { createRequestId } from '../../api/request-id.ts';
import { contextAround } from './anchor.ts';

export interface NewHighlight {
  chapter: number;
  start: number;
  end: number;
  /** 这一章的正文（textContent），原句和前后文都从这里取。 */
  chapterText: string;
  color: HighlightColor;
  note?: string | null;
  deviceLabel: string;
  keyPointId?: string;
}

/** 选区 → 新建高亮的请求体：原句、前后各 32 字、颜色、设备；收下重点时带 keyPointId。 */
export function highlightRequest(input: NewHighlight, requestId = createRequestId()): CreateBookAnnotationRequest {
  const quote = input.chapterText.slice(input.start, input.end);
  const { prefix, suffix } = contextAround(input.chapterText, input.start, input.end);
  return {
    requestId,
    chapter: input.chapter,
    start: input.start,
    end: input.end,
    quote,
    prefix,
    suffix,
    color: input.color,
    ...(input.note === undefined || input.note === null || input.note.trim() === '' ? {} : { note: input.note.trim() }),
    deviceLabel: input.deviceLabel,
    ...(input.keyPointId === undefined ? {} : { keyPointId: input.keyPointId }),
  };
}

export class AnnotationActions {
  private readonly api: BooksApi;
  private readonly bookId: string;
  private readonly after: () => void;

  constructor(api: BooksApi, bookId: string, after: () => void) {
    this.api = api;
    this.bookId = bookId;
    this.after = after;
  }

  async create(input: NewHighlight): Promise<BookAnnotationView> {
    const created = await this.api.annotate(this.bookId, highlightRequest(input));
    this.after();
    return created;
  }

  async recolor(annotation: BookAnnotationView, color: HighlightColor): Promise<void> {
    await this.api.updateAnnotation(this.bookId, annotation.id,
      { requestId: createRequestId(), version: annotation.version, color });
    this.after();
  }

  async editNote(annotation: BookAnnotationView, note: string): Promise<void> {
    const trimmed = note.trim();
    await this.api.updateAnnotation(this.bookId, annotation.id,
      { requestId: createRequestId(), version: annotation.version, note: trimmed === '' ? null : trimmed });
    this.after();
  }

  async remove(annotation: BookAnnotationView): Promise<void> {
    await this.api.removeAnnotation(this.bookId, annotation.id, createRequestId());
    this.after();
  }

  /** 收下一条重点：在它的原文那一处建一条 origin = plasticine 的标注。 */
  async accept(pointId: string, anchor: BookAnchor, chapterText: string, deviceLabel: string): Promise<void> {
    await this.create({ chapter: anchor.chapter, start: anchor.start, end: anchor.end, chapterText,
      color: 'ochre', deviceLabel, keyPointId: pointId });
  }

  async dismiss(pointId: string): Promise<void> {
    await this.api.dismissKeyPoint(this.bookId, { requestId: createRequestId(), pointId });
  }
}
