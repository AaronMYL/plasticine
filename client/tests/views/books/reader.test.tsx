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

/** 在正文里选中 needle 这几个字（jsdom 不会自己发 selectionchange，这里手动发）。 */
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
});

describe('阅读页 · 接着读', () => {
  it('翻到下一章再回上一章，正文直接复用这次会话已读的章节', async () => {
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

  it('读到第二章后换另一本书，从新书自己的位置开始，不沿用旧书的章节', async () => {
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

describe('阅读页 · 打开', () => {
  it('这台设备读过、别的设备之后读得更靠后：顶上一条横幅「iPhone 上读到 卷一 · 28%」，跳过去 / 留在这里', async () => {
    window.localStorage.setItem(`plasticine.books.position.${BOOK}`,
      JSON.stringify({ chapter: 0, offset: 0, percent: 0, savedAt: '2026-01-01T00:00:00.000Z' }));
    await reader();
    const banner = (await screen.findByText(/iPhone 上读到/)).closest('.bk-banner') as HTMLElement;
    expect(banner.textContent).toMatch(/^iPhone 上读到 卷一 · \d+%（.+）/);
    // 没点「跳过去」之前，这台设备的旧位置不往服务端存（不盖掉 iPhone 那份）。
    expect(document.querySelector('.bk-foot-sync')?.textContent).toContain('已同步');
    fireEvent.click(within(banner).getByRole('button', { name: '留在这里' }));
    expect(screen.queryByText(/iPhone 上读到/)).toBeNull();
  });

  it('点「跳过去」：横幅收起，跳到那台设备读到的地方并记成这台的进度', async () => {
    window.localStorage.setItem(`plasticine.books.position.${BOOK}`,
      JSON.stringify({ chapter: 0, offset: 0, percent: 0, savedAt: '2026-01-01T00:00:00.000Z' }));
    await reader();
    fireEvent.click(await screen.findByRole('button', { name: '跳过去' }));
    expect(screen.queryByText(/iPhone 上读到/)).toBeNull();
    await waitFor(() => expect(document.querySelector('.bk-foot-sync')?.textContent).toContain('正在同步'));
    const saved = JSON.parse(window.localStorage.getItem(`plasticine.books.position.${BOOK}`) ?? '{}') as
      { offset?: number };
    expect(saved.offset).toBeGreaterThan(0);
  });


  it('这台设备没读过：直接从服务端记的位置开始，不弹横幅', async () => {
    await reader();
    expect(screen.queryByText(/上读到/)).toBeNull();
    expect(document.querySelector('.bk-chapter-title')?.textContent).toBe('卷一　闺房记乐');
  });

  it('顶栏：返回、书名和章、目录 / 标注与讨论（带数）/ 大纲与重点 / 在书里找 / Aa', async () => {
    await reader();
    for (const name of ['回到图书馆', '目录', '大纲与重点', '在书里找', '字号与行距']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /标注与讨论，5 条标注/ }).textContent).toContain('5');
    fireEvent.click(screen.getByRole('button', { name: '回到图书馆' }));
    await waitFor(() => expect(window.location.hash).toBe('#/books'));
  });

  it('已有高亮按颜色画在正文里，有批注的在页边；Plasticine 的重点是虚线，标签写 Plasticine 不写「它」', async () => {
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

describe('阅读页 · 选中一段', () => {
  it('点一个颜色：建高亮的请求带原句、前后文、颜色和设备名，正文里马上画出来', async () => {
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

  it('「引用到对话」：引用片带书、章和位置（发出去是 kind = book），对话栏打开', async () => {
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

  it('「批注」就地写一句，保存成带批注的高亮', async () => {
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

  it('点已有高亮：能换颜色、删', async () => {
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

  it('页边 Plasticine 标的重点「收下」：建一条带 keyPointId 的标注（origin = plasticine）', async () => {
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

describe('阅读页 · 标注与讨论', () => {
  async function openSheet(tab: string): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: /标注与讨论，/ }));
    const sheet = await screen.findByRole('dialog', { name: '浮生六记 · 标注与讨论' });
    fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^${tab}`) }));
    return sheet;
  }

  it('标注：按章分组，筛选数对得上；对不上原文的写「原文里没找到这一段」', async () => {
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

  it('「导出成笔记」：打开新建的那篇笔记', async () => {
    await reader();
    const sheet = await openSheet('标注');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: '导出成笔记' }));
    });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
  });

  it('讨论：主对话里引用过这本书的几轮，「回到对话 ›」去那条消息', async () => {
    await reader();
    const sheet = await openSheet('讨论');
    await within(sheet).findByText(/这句东坡原诗是什么/);
    expect(sheet.textContent).toContain('出自苏轼');
    fireEvent.click(within(sheet).getAllByRole('button', { name: '回到对话 ›' })[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/line%3Aline-main%3A\d+$/));
  });

  it('重点：出处写「卷一 · n% · 有原文 n 处」或「推断 · 没有直接原文」，全程写 Plasticine 不写「它」', async () => {
    await reader();
    const sheet = await openSheet('重点');
    expect(within(sheet).getByText(/^Plasticine 写的/)).toBeTruthy();
    expect(sheet.textContent).toMatch(/卷一 · \d+% · 有原文 1 处/);
    expect(sheet.textContent).toContain('推断 · 没有直接原文');
    expect(sheet.textContent).not.toContain('它');
    const toggle = within(sheet).getByRole('checkbox', { name: '在原文里标出' });
    fireEvent.click(toggle);
    expect(document.querySelectorAll('.bk-content .bk-ai')).toHaveLength(0);
    expect(window.localStorage.getItem(`plasticine.books.key-points.${BOOK}`)).toBe('0');
  });

  it('大纲：正在读的这一章那一段标「你在这」', async () => {
    await reader();
    const sheet = await openSheet('大纲');
    expect(within(sheet).getByText('闺房记乐').closest('button')?.getAttribute('aria-current')).toBe('true');
    expect(sheet.textContent).toContain('你在这');
  });

  it('没有大纲的书：生成 → 「Plasticine 正在逐章归纳…」→ 失败写服务端的原因和「再试一次」', async () => {
    const app = await reader({ hash: '#/books/book_cihua' });
    app.control.books.failNextInsight('模型这会儿连不上');
    fireEvent.click(screen.getByRole('button', { name: /标注与讨论，/ }));
    const sheet = await screen.findByRole('dialog', { name: '人间词话 · 标注与讨论' });
    fireEvent.click(within(sheet).getByRole('button', { name: '大纲' }));
    await act(async () => {
      fireEvent.click(await within(sheet).findByRole('button', { name: '生成大纲' }));
    });
    await within(sheet).findByText(/模型这会儿连不上/);
    expect(within(sheet).getByRole('button', { name: '再试一次' })).toBeTruthy();
  });
});
