import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';

it('笔记多选会替换阅读区，移动后列表与最近删除数量同步', async () => {
  const app = await renderApp({ hash: '#/notes', setup: (fake) => {
    seedNote(fake, 'a', '# 第一篇', { folder: '笔记' });
    seedNote(fake, 'b', '# 第二篇', { folder: '笔记' });
  } });
  fireEvent.click(await screen.findByRole('button', { name: '选择' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
  expect(screen.getByRole('heading', { name: '选了 2 篇笔记' })).toBeTruthy();
  expect(document.querySelector('.note-row[aria-current="true"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '移到…' }));
  fireEvent.change(screen.getByLabelText('目标文件夹'), { target: { value: '归档' } });
  fireEvent.click(screen.getByRole('button', { name: '移动' }));
  await waitFor(async () => expect((await app.api.notes.get('a')).folder).toBe('归档'));
  fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '删除 2 项' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '选择第一篇' })).toBeNull());
  await act(async () => app.state.notesUi.set({ collection: { kind: 'deleted' } }));
  await waitFor(() => expect(screen.getByRole('button', { name: '清空' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  fireEvent.click(screen.getByRole('button', { name: '永久删除 2 项' }));
  await waitFor(async () => expect(await app.api.notes.list({ deletedOnly: true })).toEqual([]));
});

it('资料库选择空间删除后刷新列表和最近删除，批量还原后即时移出回收', async () => {
  const app = await renderApp({ hash: '#/library', setup: (fake) => fake.control.spaces.seed() });
  const row = (await app.api.spaces.list()).spaces[0]!;
  fireEvent.click(await screen.findByRole('button', { name: '选择' }));
  fireEvent.click(screen.getByRole('checkbox', { name: `选择${row.title}` }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '删除 1 项' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: `选择${row.title}` })).toBeNull());
  expect((await app.api.library.trash()).items.some((item) => item.id === row.id)).toBe(true);
  await act(async () => { window.location.hash = '#/library/trash'; });
  fireEvent.click(await screen.findByRole('button', { name: '选择' }));
  fireEvent.click(screen.getByRole('checkbox', { name: `选择${row.title}` }));
  fireEvent.click(screen.getByRole('button', { name: '还原' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: `选择${row.title}` })).toBeNull());
  expect((await app.api.spaces.list()).spaces.some((item) => item.id === row.id)).toBe(true);
});

it('文件页多选发送文件与文件夹身份，删除后刷新到最近删除', async () => {
  const app = await renderApp({ hash: '#/tools/files', setup: (fake) => {
    fake.control.m5b.files.seed('报告', 'directory');
    fake.control.m5b.files.seed('报告/摘要.md');
    fake.control.m5b.files.seed('说明.txt');
  } });
  fireEvent.click((await screen.findAllByRole('button', { name: '选择' }))[0]!);
  fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '删除 2 项' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '选择说明.txt' })).toBeNull());
  expect((await app.api.library.trash()).items.map((item) => item.kind).sort()).toEqual(['file', 'folder']);
});

it('图书馆批量删除与数量同步，选择时只保留一份书目', async () => {
  const { seedBooks } = await import('../../../src/api/fake/seed-books.ts');
  const app = await renderApp({ hash: '#/books', setup: (fake) => {
    seedBooks(fake.control.books, fake.control.lines, new Date('2026-10-27T02:00:00Z'));
  } });
  const books = (await app.api.books.list()).books;
  fireEvent.click(await screen.findByRole('button', { name: '选择' }));
  expect(screen.queryByRole('region', { name: '在读' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: `选择${books[0]!.title}` }));
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  fireEvent.click(screen.getByRole('button', { name: '删除 1 项' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: `选择${books[0]!.title}` })).toBeNull());
  expect((await app.api.books.list()).books).toHaveLength(books.length - 1);
});

it('手机仅放行文件工具，能进行批量选择，其他工具保持原入口限制', async () => {
  await renderApp({ width: 390, hash: '#/tools/files', setup: (fake) => {
    fake.control.m5b.files.seed('示例.txt');
  } });
  fireEvent.click((await screen.findAllByRole('button', { name: '选择' }))[0]!);
  expect(screen.getByRole('checkbox', { name: '选择示例.txt' })).toBeTruthy();
  expect(screen.queryByText('工具暂时不能在手机打开。')).toBeNull();
  await act(async () => { window.location.hash = '#/tools/money'; });
  expect(await screen.findByText('工具暂时不能在手机打开。')).toBeTruthy();
});
