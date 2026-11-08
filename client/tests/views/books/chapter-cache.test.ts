import { describe, expect, it, vi } from 'vitest';
import type { EventListener } from '../../../src/api/events-hub.ts';
import type { BookChapterResponse } from '../../../src/api/shared.ts';
import { ChapterCache } from '../../../src/views/books/chapter-cache.ts';

function chapter(bookId = 'book_a', index = 0, html = '<p>正文</p>'): BookChapterResponse {
  return { bookId, index, title: '第一章', html, chars: 2, assetBaseUrl: `/v2/books/${bookId}/assets/` };
}

function events() {
  let listener: EventListener | null = null;
  return {
    on(next: EventListener) {
      listener = next;
      return () => { listener = null; };
    },
    emit(event: Parameters<EventListener>[0]) { listener?.(event); },
  };
}

describe('阅读章节会话缓存', () => {
  it('同时打开同一章共用请求，离开其中一处不取消另一处的读取', async () => {
    const pending = Promise.withResolvers<BookChapterResponse>();
    const read = vi.fn((_id: string, _index: number, _signal?: AbortSignal) => pending.promise);
    const cache = new ChapterCache({ chapter: read });
    const firstReader = new AbortController();
    const first = cache.load('book_a', 0, firstReader.signal);
    const second = cache.load('book_a', 0);
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    firstReader.abort();
    await cancelled;
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[2]?.aborted).toBe(false);
    pending.resolve(chapter());
    expect(await second).toEqual(chapter());
    expect(cache.peek('book_a', 0)).toEqual(chapter());
  });

  it('更新进度或批注保留正文，书本失效只清该书，退出时旧请求不能重新填回', async () => {
    const read = vi.fn(async (id: string, index: number, _signal?: AbortSignal) => chapter(id, index));
    const cache = new ChapterCache({ chapter: read });
    const hub = events();
    const stop = cache.connect(hub);
    await cache.load('book_a', 0);
    await cache.load('book_b', 0);
    hub.emit({ type: 'book.changed', bookId: 'book_a', part: 'progress' });
    hub.emit({ type: 'book.changed', bookId: 'book_a', part: 'annotations' });
    await cache.load('book_a', 0);
    expect(read).toHaveBeenCalledTimes(2);
    hub.emit({ type: 'book.changed', bookId: 'book_a', part: 'book' });
    expect(cache.peek('book_a', 0)).toBeNull();
    expect(cache.peek('book_b', 0)).not.toBeNull();

    const late = Promise.withResolvers<BookChapterResponse>();
    read.mockReturnValueOnce(late.promise);
    const request = cache.load('book_a', 1);
    stop();
    expect(read.mock.calls.at(-1)?.[2]?.aborted).toBe(true);
    late.resolve(chapter('book_a', 1));
    await request;
    expect(cache.peek('book_a', 1)).toBeNull();
    expect(cache.peek('book_b', 0)).toBeNull();
  });

  it('连续翻阅只留下最近章节，单章过长时可读但不进入缓存', async () => {
    const read = vi.fn(async (id: string, index: number) => chapter(id, index));
    const cache = new ChapterCache({ chapter: read });
    for (let index = 0; index < 13; index += 1) {
      await cache.load('book_a', index);
    }
    expect(cache.peek('book_a', 0)).toBeNull();
    expect(cache.peek('book_a', 12)).not.toBeNull();
    const long = chapter('book_b', 0, '文'.repeat(2_000_001));
    read.mockResolvedValueOnce(long);
    expect(await cache.load('book_b', 0)).toBe(long);
    expect(cache.peek('book_b', 0)).toBeNull();
  });
});
