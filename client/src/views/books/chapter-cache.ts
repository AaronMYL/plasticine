// 章节正文在同一本书内不变；会话内复用已读章节，进度和批注仍由各自的接口同步。
// 不写入浏览器持久存储；退出登录时随 Live 清空，避免大书一直占着内存。

import type { BooksApi } from '../../api/books-client.ts';
import type { BookChapterResponse } from '../../api/shared.ts';
import type { EventsHub } from '../../api/events-hub.ts';

// 保留前后翻阅的章节；同时限制 HTML 字符总量，防止少数超长章节撑大缓存。
const MAX_CHAPTERS = 12;
const MAX_HTML_CHARS = 2_000_000;

interface Flight {
  bookId: string;
  controller: AbortController;
  promise: Promise<BookChapterResponse>;
}

function chapterKey(bookId: string, index: number): string {
  return JSON.stringify([bookId, index]);
}

/** 取消一个阅读者，不取消另一个阅读者共用的请求。 */
function forReader<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return request;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    request.then((value) => {
      signal.removeEventListener('abort', aborted);
      resolve(value);
    }, (cause: unknown) => {
      signal.removeEventListener('abort', aborted);
      reject(cause);
    });
  });
}

export class ChapterCache {
  private readonly api: Pick<BooksApi, 'chapter'>;
  private readonly entries = new Map<string, BookChapterResponse>();
  private readonly flights = new Map<string, Flight>();
  private chars = 0;

  constructor(api: Pick<BooksApi, 'chapter'>) {
    this.api = api;
  }

  connect(hub: Pick<EventsHub, 'on'>): () => void {
    const off = hub.on((event) => {
      if (event.type === 'resync') {
        this.clear();
      } else if (event.type === 'book.changed' && event.part === 'book') {
        this.invalidate(event.bookId);
      }
    });
    return () => {
      off();
      this.clear();
    };
  }

  peek(bookId: string, index: number): BookChapterResponse | null {
    const key = chapterKey(bookId, index);
    const value = this.entries.get(key);
    if (value === undefined) {
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  load(bookId: string, index: number, signal?: AbortSignal): Promise<BookChapterResponse> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const cached = this.peek(bookId, index);
    if (cached !== null) {
      return forReader(Promise.resolve(cached), signal);
    }
    const key = chapterKey(bookId, index);
    let flight = this.flights.get(key);
    if (flight === undefined) {
      const controller = new AbortController();
      const request = this.api.chapter(bookId, index, controller.signal).then((chapter) => {
        // 即使接口忽略取消，也不能让退出登录或失效之前的响应重新填回缓存。
        if (!controller.signal.aborted && this.flights.get(key)?.controller === controller) {
          this.remember(key, chapter);
        }
        return chapter;
      }).finally(() => {
        if (this.flights.get(key)?.controller === controller) {
          this.flights.delete(key);
        }
      });
      flight = { bookId, controller, promise: request };
      this.flights.set(key, flight);
    }
    return forReader(flight.promise, signal);
  }

  private remember(key: string, chapter: BookChapterResponse): void {
    if (chapter.html.length > MAX_HTML_CHARS) {
      return;
    }
    const previous = this.entries.get(key);
    this.chars -= previous?.html.length ?? 0;
    this.entries.delete(key);
    this.entries.set(key, chapter);
    this.chars += chapter.html.length;
    while (this.entries.size > MAX_CHAPTERS || this.chars > MAX_HTML_CHARS) {
      const oldest = this.entries.entries().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest[0]);
      this.chars -= oldest[1].html.length;
    }
  }

  private invalidate(bookId: string): void {
    for (const [key, chapter] of this.entries) {
      if (chapter.bookId === bookId) {
        this.entries.delete(key);
        this.chars -= chapter.html.length;
      }
    }
    for (const [key, flight] of this.flights) {
      if (flight.bookId === bookId) {
        this.flights.delete(key);
        flight.controller.abort();
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.chars = 0;
    const flights = [...this.flights.values()];
    this.flights.clear();
    for (const flight of flights) {
      flight.controller.abort();
    }
  }
}
