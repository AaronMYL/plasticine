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

describe('图书馆', () => {
  it('页头只有标题；没有封面图的书画文字封面，中文短书名竖排', async () => {
    await library();
    expect(screen.getByRole('heading', { level: 1, name: '图书' })).toBeTruthy();
    // 2026-11-03《全量界面优化》：页头不写副标题；封面不写格式。11-04 重做悬停：本数、在读和下面各节重复，删掉。
    expect(screen.getByRole('heading', { level: 1, name: '图书' }).hasAttribute('title')).toBe(false);
    const cover = screen.getAllByRole('img', { name: '《浮生六记》文字封面' })[0] as HTMLElement;
    expect(cover.dataset.vertical).toBe('true');
    expect(cover.textContent).toContain('沈复');
    expect(cover.textContent).not.toContain('EPUB');
  });

  it('「在读」只列读到一半的书，带章名、进度、上次读的时间和哪台设备，「接着读」打开那本书', async () => {
    await library();
    const reading = screen.getByRole('region', { name: '在读' });
    const titles = [...reading.querySelectorAll('.bk-title')].map((node) => node.textContent);
    expect(titles).toEqual(['浮生六记', '人间词话']);
    expect(within(reading).getByText('卷一 · 闺房记乐')).toBeTruthy();
    // 11-04 重做悬停：上次读的时间和哪台设备一起常显。
    const progress = reading.querySelector('.bk-progress-row');
    expect(progress?.hasAttribute('data-tip')).toBe(false);
    expect(progress?.querySelector('time')?.textContent).toContain('iPhone');
    fireEvent.click(within(reading).getAllByRole('button', { name: '接着读' })[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#/books/book_fusheng'));
  });

  it('格子下面写百分比、读完是一个勾、未读什么都不写；排序能按书名、作者换', async () => {
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

  it('导入不认识的格式：一行写服务端那句话（415），不是堆栈', async () => {
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

  it('导入一本 TXT：成功后出现在「全部」里', async () => {
    await library();
    const input = screen.getByLabelText('选择要导入的书') as HTMLInputElement;
    const file = new File(['第一行\n\n第二行'], '新书.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(gridTitles()).toContain('新书'));
    expect(screen.queryByText(/正在导入/)).toBeNull();
  });

  it('删书要先确认，确认后从图书馆里拿掉', async () => {
    await library();
    fireEvent.click(screen.getByRole('button', { name: '《庄子》的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /从图书馆删掉/ }));
    expect(screen.getByText(/删掉《庄子》？/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删掉' }));
    await waitFor(() => expect(gridTitles()).not.toContain('庄子'));
  });

});
