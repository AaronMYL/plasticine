// 阅读页 · 翻页模式（第 7 批第 3 条：默认翻页、单页，「Aa」里能切回滚动）。jsdom 不排版，每章只算一页：
// 往后翻就是进下一章第一页，往前翻进上一章最后一页；进度在翻完时记。排版本身的算法见 paginator.test.ts。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedBooks } from '../../../src/api/fake/seed-books.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const BOOK = 'book_fusheng';

async function reader(): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ width: 1440, hash: `#/books/${BOOK}`,
    setup: (fake) => seedBooks(fake.control.books, fake.control.lines, NOW) });
  await waitFor(() => expect(document.querySelector('.bk-content p')).not.toBeNull());
  return app;
}

function barWhere(): string {
  return document.querySelector('.bk-bar-title span')?.textContent ?? '';
}

function local(): { chapter?: number; offset?: number } {
  return JSON.parse(window.localStorage.getItem(`plasticine.books.position.${BOOK}`) ?? '{}') as
    { chapter?: number; offset?: number };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('阅读页 · 翻页', () => {
  it('默认翻页：阅读区不滚、没有章末翻章按钮，左右两侧有上一页 / 下一页；底栏只有百分比和进度条', async () => {
    await reader();
    expect(document.querySelector('.bk-page')?.getAttribute('data-mode')).toBe('paged');
    expect(screen.queryByRole('navigation', { name: '翻章' })).toBeNull();
    expect(screen.getByRole('button', { name: '上一页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy();
    const foot = document.querySelector('.bk-foot') as HTMLElement;
    expect(foot.textContent).toMatch(/^\d+%$/);
    expect(within(foot).getByRole('progressbar', { name: '全书进度' })).toBeTruthy();
  });

  it('→ 翻过这一章最后一页进下一章第一页，记成下一章开头；← 翻回上一章最后一页', async () => {
    await reader();
    expect(barWhere()).toContain('卷一');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(barWhere()).toContain('卷二'));
    await waitFor(() => expect(local()).toMatchObject({ chapter: 1, offset: 0 }));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await waitFor(() => expect(barWhere()).toContain('卷一'));
    await waitFor(() => expect(local()).toMatchObject({ chapter: 0 }));
  });

  it('空格往后、Shift + 空格往前、PageDown / PageUp 也翻；点右侧箭头往后', async () => {
    await reader();
    fireEvent.keyDown(document.body, { key: ' ' });
    await waitFor(() => expect(barWhere()).toContain('卷二'));
    fireEvent.keyDown(document.body, { key: ' ', shiftKey: true });
    await waitFor(() => expect(barWhere()).toContain('卷一'));
    fireEvent.keyDown(document.body, { key: 'PageDown' });
    await waitFor(() => expect(barWhere()).toContain('卷二'));
    fireEvent.keyDown(document.body, { key: 'PageUp' });
    await waitFor(() => expect(barWhere()).toContain('卷一'));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(barWhere()).toContain('卷二'));
  });

  it('在输入框里、带 ⌘ 的按键不翻页（对话框照常打字，⌘[ ⌘] 是壳的后退前进）', async () => {
    await reader();
    const box = screen.getByRole('textbox', { name: '问一句' });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(barWhere()).toContain('卷一');
  });

  it('「Aa」里切成滚动：存在这台设备上，章末翻章按钮回来；再切回翻页', async () => {
    await reader();
    fireEvent.click(screen.getByRole('button', { name: '字号与翻页' }));
    const menu = screen.getByRole('dialog', { name: '字号与翻页' });
    const modes = within(menu).getByRole('group', { name: '阅读方式' });
    expect(within(modes).getByRole('button', { name: '翻页' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(within(menu).getByRole('group', { name: '行距' })).getAllByRole('button')
      .map((button) => button.textContent)).toEqual(['紧凑', '适中', '宽松']);
    fireEvent.click(within(modes).getByRole('button', { name: '滚动' }));
    expect(document.querySelector('.bk-page')?.getAttribute('data-mode')).toBe('scroll');
    expect(window.localStorage.getItem('plasticine.books.mode')).toBe('scroll');
    expect(screen.getByRole('navigation', { name: '翻章' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(barWhere()).toContain('卷一');
    fireEvent.click(within(modes).getByRole('button', { name: '翻页' }));
    expect(document.querySelector('.bk-page')?.getAttribute('data-mode')).toBe('paged');
  });

  it('字号是五档分段，选一档记在这台设备上', async () => {
    await reader();
    fireEvent.click(screen.getByRole('button', { name: '字号与翻页' }));
    const sizes = within(screen.getByRole('dialog', { name: '字号与翻页' })).getByRole('group', { name: '字号' });
    expect(within(sizes).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['15', '16', '17', '18', '20']);
    fireEvent.click(within(sizes).getByRole('button', { name: '20' }));
    expect(JSON.parse(window.localStorage.getItem('plasticine.books.typography') ?? '{}')).toMatchObject({ size: 4 });
  });
});
