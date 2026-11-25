import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { seedBooks } from '../../../src/api/fake/seed-books.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const BOOK = 'book_fusheng';

async function reader(options: { hash?: string; width?: number; setup?: (fake: FakeApi) => void } = {}) {
  const app = await renderApp({ width: options.width ?? 1440, hash: options.hash ?? `#/books/${BOOK}`,
    setup: (fake) => {
      seedBooks(fake.control.books, fake.control.lines, NOW);
      options.setup?.(fake);
    } });
  await waitFor(() => expect(document.querySelector('.bk-content p')).not.toBeNull());
  return app;
}

async function select(needle: string): Promise<void> {
  const root = document.querySelector('.bk-content') as HTMLElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const at = text.data.indexOf(needle);
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + needle.length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await screen.findByRole('dialog', { name: '选中的这段' }, { timeout: 2000 });
      return;
    }
  }
  throw new Error(`正文里没有「${needle}」`);
}

function chapterText(fake: FakeApi): string {
  return fake.control.books.chapterText(BOOK, 0);
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('plasticine.books.mode', 'scroll');
});

describe('reader page: resume reading', () => {
  it('turning to next chapter and back reuses session-cached chapter body', async () => {
    const chapters: number[] = [];
    await reader({ setup: (fake) => {
      const read = fake.api.books.chapter.bind(fake.api.books);
      vi.spyOn(fake.api.books, 'chapter').mockImplementation((id, index, signal) => {
        chapters.push(index);
        return read(id, index, signal);
      });
    } });
    const original = document.querySelector('.bk-content')?.textContent;
    fireEvent.click(screen.getByRole('button', { name: /^下一章/ }));
    await waitFor(() => expect(document.querySelector('.bk-content')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('.bk-content')?.textContent).not.toBe(original));
    fireEvent.click(screen.getByRole('button', { name: /上一章/ }));
    await waitFor(() => expect(document.querySelector('.bk-content')?.textContent).toBe(original));
    expect(chapters.filter((index) => index === 0)).toHaveLength(1);
  });

  it('switching to another book starts at that book\'s own position without leaking old chapter', async () => {
    const reads: Array<{ id: string; index: number }> = [];
    const app = await reader({ setup: (fake) => {
      const read = fake.api.books.chapter.bind(fake.api.books);
      vi.spyOn(fake.api.books, 'chapter').mockImplementation((id, index, signal) => {
        reads.push({ id, index });
        return read(id, index, signal);
      });
    } });
    const nextBook = await app.api.books.get('book_cihua');
    fireEvent.click(screen.getByRole('button', { name: /^下一章/ }));
    await waitFor(() => expect(reads).toContainEqual({ id: BOOK, index: 1 }));
    await act(async () => {
      window.location.hash = '#/books/book_cihua';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(reads.some((item) => item.id === 'book_cihua')).toBe(true));
    expect(reads.find((item) => item.id === 'book_cihua')?.index).toBe(nextBook.progress?.chapter ?? 0);
  });
});

describe('reader page: opening a book', () => {
  it('shows cross-device banner with Jump/Stay when another device read further', async () => {
    window.localStorage.setItem(`plasticine.books.position.${BOOK}`,
      JSON.stringify({ chapter: 0, offset: 0, percent: 0, savedAt: '2026-01-01T00:00:00.000Z' }));
    const app = await reader();
    const save = vi.spyOn(app.api.books, 'saveProgress');
    const banner = (await screen.findByText(/iPhone 上读到/)).closest('.bk-banner') as HTMLElement;
    expect(banner.textContent).toMatch(/^iPhone 上读到 卷一 · \d+%（.+）/);
    expect(document.querySelector('.bk-foot-sync')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(`plasticine.books.position.${BOOK}`) ?? '{}'))
      .toMatchObject({ offset: 0, savedAt: '2026-01-01T00:00:00.000Z' });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(banner).getByRole('button', { name: '留在这里' }));
    expect(screen.queryByText(/iPhone 上读到/)).toBeNull();
  });

  it('clicking Jump dismisses banner, jumps to remote position, and saves it locally', async () => {
    window.localStorage.setItem(`plasticine.books.position.${BOOK}`,
      JSON.stringify({ chapter: 0, offset: 0, percent: 0, savedAt: '2026-01-01T00:00:00.000Z' }));
    const app = await reader();
    const save = vi.spyOn(app.api.books, 'saveProgress');
    fireEvent.click(await screen.findByRole('button', { name: '跳过去' }));
    expect(screen.queryByText(/iPhone 上读到/)).toBeNull();
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 4000 });
    const saved = JSON.parse(window.localStorage.getItem(`plasticine.books.position.${BOOK}`) ?? '{}') as
      { offset?: number };
    expect(saved.offset).toBeGreaterThan(0);
  });

  it('unread device starts directly at server position without showing banner', async () => {
    await reader();
    expect(screen.queryByText(/上读到/)).toBeNull();
    expect(document.querySelector('.bk-chapter-title')?.textContent).toBe('卷一　闺房记乐');
  });

  it('top bar shows Back, book/chapter, TOC, Notes & Discussion count, Outline, Search, and Aa', async () => {
    await reader();
    for (const name of ['回到图书馆', '目录', '大纲与重点', '在书里找', '字号与翻页']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /标注与讨论，5 条标注/ }).textContent).toContain('5');
    fireEvent.click(screen.getByRole('button', { name: '回到图书馆' }));
    await waitFor(() => expect(window.location.hash).toBe('#/books'));
  });

  it('renders colored highlights, margin notes, dashed Plasticine key points labeled Plasticine', async () => {
    await reader();
    const highlights = [...document.querySelectorAll<HTMLElement>('.bk-content .bk-hl')];
    expect(highlights.map((node) => node.dataset.c)).toContain('sage');
    expect(document.querySelectorAll('.bk-content .bk-ai').length).toBeGreaterThan(0);
    const margins = screen.getByLabelText('页边批注与重点');
    expect(margins.textContent).toContain('Plasticine 标的重点');
    expect(margins.textContent).toContain('写下来，才不辜负');
    expect(margins.textContent).not.toContain('它');
  });

});

describe('reader page: text selection', () => {
  it('picking color creates highlight with quote, context, color, device and renders immediately', async () => {
    const app = await reader();
    const annotate = vi.spyOn(app.api.books, 'annotate');
    await select('若必考订其文法');
    const menu = screen.getByRole('dialog', { name: '选中的这段' });
    expect(within(menu).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['引用到对话', '高亮成赭黄', '高亮成灰绿', '高亮成灰蓝', '高亮成灰粉', '批注', '复制']);
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: '高亮成灰绿' }));
    });
    const text = chapterText(app);
    const start = text.indexOf('若必考订其文法');
    expect(annotate).toHaveBeenCalledWith(BOOK, expect.objectContaining({
      chapter: 0, start, end: start + 7, quote: '若必考订其文法', color: 'sage', deviceLabel: '浏览器',
      prefix: text.slice(start - 32, start), suffix: text.slice(start + 7, start + 39),
    }));
    await waitFor(() => expect([...document.querySelectorAll('.bk-content .bk-hl')]
      .some((node) => node.textContent === '若必考订其文法')).toBe(true));
  });

  it('Quote to Chat adds book quote chip with chapter/offset (kind=book) and opens chat', async () => {
    const app = await reader();
    await select('不过记其实情实事而已');
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    const [quote] = app.state.conversationUi.store.get().quotes;
    const start = chapterText(app).indexOf('不过记其实情实事而已');
    expect(quote?.kind).toBe('book');
    expect(quote?.bookReference).toEqual({ bookId: BOOK, chapter: 0, start, end: start + 10, text: '不过记其实情实事而已' });
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(true);
    await screen.findByRole('complementary', { name: '对话框' });
  });

  it('Annotate saves inline note attached to highlight', async () => {
    const app = await reader();
    const annotate = vi.spyOn(app.api.books, 'annotate');
    await select('稍识之无');
    fireEvent.click(screen.getByRole('button', { name: '批注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '批注' }), { target: { value: '谦辞' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    expect(annotate).toHaveBeenCalledWith(BOOK, expect.objectContaining({ quote: '稍识之无', note: '谦辞' }));
  });

  it('clicking existing highlight allows changing color or deleting', async () => {
    const app = await reader();
    const update = vi.spyOn(app.api.books, 'updateAnnotation');
    const target = [...document.querySelectorAll<HTMLElement>('.bk-content .bk-hl')]
      .find((node) => node.dataset.c === 'sage') as HTMLElement;
    fireEvent.click(target);
    const menu = screen.getByRole('dialog', { name: '这条高亮' });
    expect(within(menu).getByRole('button', { name: '高亮成灰绿' }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: '高亮成灰粉' }));
    });
    expect(update).toHaveBeenCalledWith(BOOK, 'seed_ann_2', expect.objectContaining({ color: 'rose', version: 1 }));
  });

  it('accepting Plasticine key point creates annotation with keyPointId and origin=plasticine', async () => {
    const app = await reader();
    const annotate = vi.spyOn(app.api.books, 'annotate');
    const margins = screen.getByLabelText('页边批注与重点');
    await act(async () => {
      fireEvent.click(within(margins).getAllByRole('button', { name: '收下' })[0] as HTMLElement);
    });
    expect(annotate).toHaveBeenCalledWith(BOOK, expect.objectContaining({ keyPointId: expect.any(String) }));
    const { annotations } = await app.api.books.annotations(BOOK);
    expect(annotations.filter((row) => row.origin === 'plasticine')).toHaveLength(2);
  });
});

describe('reader page: annotations and discussion', () => {
  async function openSheet(tab: string): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: /标注与讨论，/ }));
    const sheet = await screen.findByRole('complementary', { name: '图书笔记' });
    fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^${tab}`) }));
    return sheet;
  }

  it('groups annotations by chapter with accurate filter counts and marks unanchored quotes', async () => {
    await reader({ setup: (fake) => fake.control.books.seedAnnotation({ id: 'lost', bookId: BOOK, chapter: 0,
      start: 3, end: 9, quote: '换了版本删掉的话', prefix: '', suffix: '', color: 'rose', note: null, origin: 'user',
      deviceLabel: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), version: 1 }) });
    const sheet = await openSheet('标注');
    expect(within(sheet).getByRole('button', { name: '高亮 3' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '批注 2' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: '收下的重点 1' })).toBeTruthy();
    expect(within(sheet).getByText('原文里没找到这一段')).toBeTruthy();
    expect(within(sheet).getByText('Plasticine 标的 · 已收下')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '批注 2' }));
    expect(sheet.querySelectorAll('.bk-ann')).toHaveLength(2);
  });

  it('Export to Note opens the newly created note', async () => {
    await reader();
    const sheet = await openSheet('标注');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: '导出成笔记' }));
    });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
  });

  it('Discussion lists main-thread turns quoting the book with Back to Chat jump link', async () => {
    await reader();
    const sheet = await openSheet('讨论');
    await within(sheet).findByText(/这句东坡原诗是什么/);
    expect(sheet.textContent).toContain('出自苏轼');
    fireEvent.click(within(sheet).getAllByRole('button', { name: '回到对话 ›' })[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/line%3Aline-main%3A\d+$/));
  });

  it('key points display category and source offset in same space and control body highlights', async () => {
    await reader();
    const sheet = await openSheet('重点');
    const frame = await within(sheet).findByTitle('浮生六记 · 重点');
    expect(frame.getAttribute('srcdoc')).toContain('原文要点');
    expect(frame.getAttribute('srcdoc')).toContain('data-link="book:book_fusheng:');
    const toggle = within(sheet).getByRole('checkbox', { name: '在原文里标出' });
    fireEvent.click(toggle);
    expect(document.querySelectorAll('.bk-content .bk-ai')).toHaveLength(0);
    expect(window.localStorage.getItem(`plasticine.books.key-points.${BOOK}`)).toBe('0');
  });

  it('outline renders rich chapter summaries and active badge without word-count bars', async () => {
    await reader();
    const sheet = await openSheet('大纲');
    const frame = await within(sheet).findByTitle('浮生六记 · 大纲');
    expect(frame.getAttribute('srcdoc')).not.toContain('各部分字数比例');
    expect(frame.getAttribute('srcdoc')).toContain('class="bn-list"');
    expect(frame.getAttribute('srcdoc')).toContain('读到这里');
  });

  it('jumping from space to source lands on chapter/offset while keeping outline open and synced', async () => {
    await reader();
    const sheet = await openSheet('大纲');
    const frame = await within(sheet).findByTitle('浮生六记 · 大纲') as HTMLIFrameElement;
    const sent: unknown[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message: unknown) => { sent.push(message); });
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
        data: { pz: 'space', type: 'link', kind: 'book', id: 'book_fusheng:1:7' } }));
    });
    await waitFor(() => expect(document.querySelector('.bk-bar-title')?.textContent).toContain('闲情记趣'));
    expect(screen.getByRole('complementary', { name: '图书笔记' })).toBeTruthy();
    expect(sent).toContainEqual({ pz: 'space', type: 'book-position', bookId: 'book_fusheng', chapter: 1 });
  });

  it('book without outline generates with progress status and shows server error + Retry on fail', async () => {
    const app = await reader({ hash: '#/books/book_cihua' });
    app.control.books.failNextInsight('模型这会儿连不上');
    fireEvent.click(screen.getByRole('button', { name: /标注与讨论，/ }));
    const sheet = await screen.findByRole('complementary', { name: '图书笔记' });
    fireEvent.click(within(sheet).getByRole('button', { name: '大纲' }));
    await act(async () => {
      fireEvent.click(await within(sheet).findByRole('button', { name: '生成大纲' }));
    });
    await within(sheet).findByText(/模型这会儿连不上/);
    expect(within(sheet).getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
