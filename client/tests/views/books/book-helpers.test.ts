import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BooksApi } from '../../../src/api/books-client.ts';
import type { BookProgressView } from '../../../src/api/shared.ts';
import { parseHash, routeHash } from '../../../src/shell/routes.ts';
import { highlightRequest } from '../../../src/views/books/annotation-actions.ts';
import { chapterShort, progressLabel, verticalTitle } from '../../../src/views/books/book-format.ts';
import { deviceLabelOf } from '../../../src/views/books/device-label.ts';
import { pointSource } from '../../../src/views/books/key-points.ts';
import { PROGRESS_SAVE_DELAY_MS, ProgressSaver } from '../../../src/views/books/progress-saver.ts';
import { otherDeviceAhead, startPosition } from '../../../src/views/books/reading-position.ts';

const TOC = [{ title: '卷一　闺房记乐', chars: 100 }, { title: '卷二　闲情记趣', chars: 100 }];

function progress(fields: Partial<BookProgressView>): BookProgressView {
  return { chapter: 1, offset: 40, percent: 0.7, deviceLabel: 'iPhone', updatedAt: '2026-11-01T08:12:00.000Z',
    version: 2, ...fields };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('设备名', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 0, 'iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5, 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, 'Mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0, 'Windows'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5, 'Android'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, '浏览器'],
  ])('%s（触点 %s）→ %s', (agent, touch, label) => {
    expect(deviceLabelOf(agent, touch)).toBe(label);
  });
});

describe('打开时从哪读起、要不要提示别的设备', () => {
  const local = { chapter: 0, offset: 10, percent: 0.05, savedAt: '2026-10-31T22:00:00.000Z' };

  it('地址里带了位置就去那儿；这台读过接着这台；没读过用服务端的；都没有从头', () => {
    expect(startPosition({ chapter: 1, offset: 3 }, local, progress({}))).toEqual({ chapter: 1, offset: 3 });
    expect(startPosition(null, local, progress({}))).toEqual({ chapter: 0, offset: 10 });
    expect(startPosition(null, null, progress({}))).toEqual({ chapter: 1, offset: 40 });
    expect(startPosition(null, null, null)).toEqual({ chapter: 0, offset: 0 });
  });

  it('别的设备之后读、读得更靠后才提示；同一台、更早、更靠前都不提示', () => {
    expect(otherDeviceAhead(progress({}), local, 'Mac')?.deviceLabel).toBe('iPhone');
    expect(otherDeviceAhead(progress({ deviceLabel: 'Mac' }), local, 'Mac')).toBeNull();
    expect(otherDeviceAhead(progress({ updatedAt: '2026-10-30T00:00:00.000Z' }), local, 'Mac')).toBeNull();
    expect(otherDeviceAhead(progress({ chapter: 0, offset: 5 }), local, 'Mac')).toBeNull();
    expect(otherDeviceAhead(progress({}), null, 'Mac')).toBeNull();
  });
});

describe('进度存服务端', () => {
  it('停下 2 秒才存一次，带设备名；中间翻的几次只存最后一次', async () => {
    vi.useFakeTimers();
    const saveProgress = vi.fn(async () => progress({}));
    const saver = new ProgressSaver({ saveProgress } as unknown as BooksApi, 'b1', 'Mac');
    saver.update({ chapter: 0, offset: 10, percent: 0.1 });
    saver.update({ chapter: 0, offset: 20, percent: 0.2 });
    expect(saver.state.get().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(PROGRESS_SAVE_DELAY_MS);
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress).toHaveBeenCalledWith('b1', { chapter: 0, offset: 20, percent: 0.2, deviceLabel: 'Mac' });
    expect(saver.state.get().status).toBe('saved');
    expect(JSON.parse(window.localStorage.getItem('plasticine.books.position.b1') ?? '{}')).toMatchObject(
      { chapter: 0, offset: 20 });
  });

  it('切走时立刻存；没存上记下原因，不打断阅读', async () => {
    const saveProgress = vi.fn(async () => {
      throw new Error('断网了');
    });
    const saver = new ProgressSaver({ saveProgress } as unknown as BooksApi, 'b2', 'Mac');
    saver.update({ chapter: 1, offset: 5, percent: 0.6 });
    await saver.flush();
    expect(saveProgress).toHaveBeenCalledOnce();
    expect(saver.state.get()).toEqual({ status: 'failed', error: '出错了：断网了' });
    saver.dispose();
  });
});

describe('选区 → 新建高亮的请求体', () => {
  it('原句、前后各最多 32 字、颜色、设备；空批注不带 note；收下重点带 keyPointId', () => {
    const text = `${'前'.repeat(40)}原句在这${'后'.repeat(40)}`;
    const body = highlightRequest({ chapter: 2, start: 40, end: 44, chapterText: text, color: 'slate',
      note: '  ', deviceLabel: 'iPhone' }, 'req_00000001');
    expect(body).toEqual({ requestId: 'req_00000001', chapter: 2, start: 40, end: 44, quote: '原句在这',
      prefix: '前'.repeat(32), suffix: '后'.repeat(32), color: 'slate', deviceLabel: 'iPhone' });
    const accepted = highlightRequest({ chapter: 0, start: 0, end: 2, chapterText: text, color: 'ochre',
      note: ' 想法 ', deviceLabel: 'Mac', keyPointId: 'kp1' }, 'req_00000002');
    expect(accepted).toMatchObject({ note: '想法', keyPointId: 'kp1' });
  });
});

describe('几种写法', () => {
  it('重点出处：有原文写章、位置、几处；推断照实写', () => {
    expect(pointSource({ id: 'a', text: 't', basis: 'quoted',
      anchors: [{ chapter: 0, start: 2, end: 4, quote: 'x' }, { chapter: 0, start: 8, end: 9, quote: 'y' }] }, TOC))
      .toBe('卷一 · 1% · 有原文 2 处');
    expect(pointSource({ id: 'b', text: 't', basis: 'quoted',
      anchors: [{ chapter: 0, start: 2, end: 4, quote: 'x' }, { chapter: 1, start: 0, end: 1, quote: 'y' }] }, TOC))
      .toBe('卷一、卷二 · 有原文 2 处');
    expect(pointSource({ id: 'c', text: 't', basis: 'inferred', anchors: [] }, TOC)).toBe('推断 · 没有直接原文');
  });

  it('章名短写、读完 / 未读、竖排书名', () => {
    expect(chapterShort('卷一　闺房记乐')).toBe('卷一');
    expect(progressLabel({ progress: null })).toBe('未读');
    expect(progressLabel({ progress: progress({ percent: 1 }) })).toBe('读完');
    expect(progressLabel({ progress: progress({ percent: 0.184 }) })).toBe('18%');
    expect(verticalTitle('浮生六记')).toBe(true);
    expect(verticalTitle('The Prince')).toBe(false);
  });
});

describe('图书的地址', () => {
  it('#/books 是图书馆，#/books/<id> 是那本书，带章和字是跳到那一处；坏的位置当没给', () => {
    expect(parseHash('#/books')).toEqual({ view: 'books', noteId: null });
    expect(parseHash('#/books/book%201'))
      .toEqual({ view: 'books', noteId: null, bookId: 'book 1', bookPosition: null });
    const jump = parseHash('#/books/b1/2/340');
    expect(jump.bookPosition).toEqual({ chapter: 2, offset: 340 });
    expect(routeHash(jump)).toBe('#/books/b1/2/340');
    expect(parseHash('#/books/b1/x/3').bookPosition).toBeNull();
  });
});
