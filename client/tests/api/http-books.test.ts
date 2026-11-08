import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerEventMapper } from '../../src/api/http/event-mapper.ts';
import { BOOK_UPLOAD_TIMEOUT_MS } from '../../src/api/http/books.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import { AT, eventSources, fakeFetch, hangs, json } from './http-fixtures.ts';

afterEach(() => {
  vi.useRealTimers();
});

const ANNOTATION = { id: 'a1', bookId: 'b 1', chapter: 0, start: 0, end: 2, quote: '原句', prefix: '', suffix: '',
  color: 'sage', note: null, origin: 'user', deviceLabel: 'Mac', createdAt: AT, updatedAt: AT, version: 1 };

describe('图书接口 · 真实现', () => {
  it('路径和方法照 /v2/books 的约定，id 编码；回答先过 schema', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, ANNOTATION), () => json(200, { deleted: true }),
      () => json(200, { hits: [], truncated: false }));
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    const created = await api.books.annotate('b 1', { requestId: 'req_00000001', chapter: 0, start: 0, end: 2,
      quote: '原句', prefix: '', suffix: '', color: 'sage', deviceLabel: 'Mac' });
    expect(created.color).toBe('sage');
    await api.books.removeAnnotation('b 1', 'a1', 'req_00000002');
    await api.books.search('b 1', '春梦');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /v2/books/b%201/annotations',
      'DELETE /v2/books/b%201/annotations/a1',
      'GET /v2/books/b%201/search?q=%E6%98%A5%E6%A2%A6',
    ]);
    expect(calls[1]?.body).toEqual({ requestId: 'req_00000002' });
    expect(api.books.assetUrl({ assetBaseUrl: '/v2/books/b1/assets/' }, 'img/a 1.png'))
      .toBe('/v2/books/b1/assets/img%2Fa%201.png');
  });

  it('导入书等得久（5 分钟），没等到回答算「结果待核实」不是失败', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = fakeFetch(hangs);
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    const upload = api.books.upload({ requestId: 'req_00000003', fileName: 'a.txt', bytes: 1,
      sha256: '0'.repeat(64), content: 'YQ==' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(BOOK_UPLOAD_TIMEOUT_MS);
    expect(await upload).toMatchObject({ kind: 'uncertain' });
  });

  it('415 / 422 用服务端那句中文', async () => {
    const { fetch } = fakeFetch(() => json(415, { code: 'unsupported_type',
      error: '这个格式打不开：图书只认 EPUB、TXT、MOBI、AZW3。', field: 'content' }));
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    const error = await api.books.upload({ requestId: 'req_00000004', fileName: 'a.docx', bytes: 1,
      sha256: '0'.repeat(64), content: 'YQ==' }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: '这个格式打不开：图书只认 EPUB、TXT、MOBI、AZW3。' });
  });

  it('事件流的 book_changed 换成 book.changed，带书和哪一块', () => {
    const mapper = new ServerEventMapper();
    expect(mapper.apply({ type: 'book_changed', bookId: 'b1', part: 'insights' }))
      .toEqual([{ type: 'book.changed', bookId: 'b1', part: 'insights' }]);
  });
});
