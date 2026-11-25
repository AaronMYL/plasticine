import { toastStore } from '../../../src/primitives/toast/index.tsx';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedBooks } from '../../../src/api/fake/seed-books.ts';
import { NOW, renderApp } from '../../helpers.tsx';

async function library(width = 1440): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ width, hash: '#/books',
    setup: (fake) => seedBooks(fake.control.books, fake.control.lines, NOW) });
  await screen.findByRole('region', { name: '全部' });
  return app;
}

function gridTitles(): string[] {
  const all = screen.getByRole('region', { name: '全部' });
  return [...all.querySelectorAll('.bk-item-title')].map((node) => node.textContent ?? '');
}

describe('library page', () => {
  it('header shows title only; coverless books render typographic cover with vertical short CJK', async () => {
    await library();
    expect(screen.getByRole('heading', { level: 1, name: '图书馆' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: '图书馆' }).hasAttribute('title')).toBe(false);
    const cover = screen.getAllByRole('img', { name: '《浮生六记》文字封面' })[0] as HTMLElement;
    expect(cover.dataset.vertical).toBe('true');
    expect(cover.textContent).toContain('沈复');
    expect(cover.textContent).not.toContain('EPUB');
  });

  it('Reading section lists in-progress books with chapter, progress, device, and Resume action', async () => {
    await library();
    const reading = screen.getByRole('region', { name: '在读' });
    const titles = [...reading.querySelectorAll('.bk-title')].map((node) => node.textContent);
    expect(titles).toEqual(['浮生六记', '人间词话']);
    expect(within(reading).getByText('卷一 · 闺房记乐')).toBeTruthy();
    const progress = reading.querySelector('.bk-progress-row');
    expect(progress?.hasAttribute('data-tip')).toBe(false);
    expect(progress?.querySelector('time')?.textContent).toContain('iPhone');
    fireEvent.click(within(reading).getAllByRole('button', { name: '接着读' })[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#/books/book_fusheng'));
  });

  it('tiles show percent, check when finished, blank when unread; supports title/author sorting', async () => {
    await library();
    const all = screen.getByRole('region', { name: '全部' });
    expect(all.textContent).not.toContain('未读');
    expect(within(all).getAllByRole('img', { name: '读完' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '书名' }));
    const byTitle = gridTitles();
    expect([...byTitle].sort((a, b) => new Intl.Collator('zh-CN').compare(a, b))).toEqual(byTitle);
    fireEvent.click(screen.getByRole('button', { name: '作者' }));
    expect(gridTitles()[0]).toBe('呐喊');
  });

  it('importing unsupported format shows server 415 message inline instead of stack trace', async () => {
    await library();
    const input = screen.getByLabelText('选择要导入的书') as HTMLInputElement;
    const file = new File(['hello'], '笔记.docx', { type: 'application/octet-stream' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const row = await screen.findByText(/这个格式打不开/);
    expect(row.textContent).toContain('EPUB、TXT、MOBI、AZW3');
    expect(screen.getByText('笔记.docx')).toBeTruthy();
  });

  it('importing a TXT book adds it to All Books on success', async () => {
    await library();
    const input = screen.getByLabelText('选择要导入的书') as HTMLInputElement;
    const file = new File(['第一行\n\n第二行'], '新书.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(gridTitles()).toContain('新书'));
    expect(screen.queryByText(/正在导入/)).toBeNull();
  });

  it('reading rail Import Book returns to library showing import progress and result', async () => {
    await renderApp({ hash: '#/books/book_fusheng', setup: (fake) => seedBooks(fake.control.books, fake.control.lines,
      NOW) });
    const column = await screen.findByRole('complementary', { name: '阅读' });
    const input = within(column).getByLabelText('从阅读栏选择要导入的书') as HTMLInputElement;
    const file = new File(['第一行\n\n第二行'], '栏里导的书.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(window.location.hash).toBe('#/books'));
    await screen.findByRole('region', { name: '全部' });
    await waitFor(() => expect(gridTitles()).toContain('栏里导的书'));
  });

  it('deleting a book moves it straight to Recently Deleted with Undo toast', async () => {
    const app = await library();
    fireEvent.click(screen.getByRole('button', { name: '《庄子》的更多操作' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '删除' })));
    await waitFor(() => expect(gridTitles()).not.toContain('庄子'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const trash = await app.api.library.trash();
    expect(trash.items.map((item) => [item.kind, item.title])).toEqual([['book', '庄子']]);
    await waitFor(() => expect(toastStore.get()?.text).toBe('已把「庄子」移到最近删除'));
    await act(async () => toastStore.get()?.action?.run());
    await waitFor(async () => expect((await app.api.library.trash()).items).toEqual([]));
  });

  it('inline title rename saves on Enter and cancels on Esc', async () => {
    await library();
    fireEvent.click(screen.getByRole('button', { name: '《庄子》的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '改名' }));
    const field = screen.getByRole('textbox', { name: '《庄子》的新书名' });
    fireEvent.change(field, { target: { value: '庄子（内篇）' } });
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }));
    await waitFor(() => expect(gridTitles()).toContain('庄子（内篇）'));
    fireEvent.click(screen.getByRole('button', { name: '《庄子（内篇）》的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '改名' }));
    const again = screen.getByRole('textbox', { name: '《庄子（内篇）》的新书名' });
    fireEvent.change(again, { target: { value: '别的' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(gridTitles()).toContain('庄子（内篇）');
  });

});
