import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, NOW } from '../../helpers.tsx';
import { seedBooks } from '../../../src/api/fake/seed-books.ts';
import { createRequestId } from '../../../src/api/request-id.ts';
import { libraryChanged } from '../../../src/views/library/library-signal.ts';

it('文件回收清空只删除确认时文件清单，保留隐藏空间、书和确认后新到的文件', async () => {
  const app = await renderApp({ hash: '#/tools/files', setup: ({ control }) => {
    control.m5b.files.seed('归档', 'directory'); control.m5b.files.seed('归档/记录.txt');
    control.m5b.files.seed('稍后.txt'); control.spaces.seed(); seedBooks(control.books, control.lines, NOW);
  } });
  const space = (await app.api.spaces.list()).spaces[0]!;
  const book = (await app.api.books.list()).books[0]!;
  await act(async () => {
    await app.api.files.trash({ requestId: createRequestId(), path: '归档', confirmName: '归档' });
    await app.api.spaces.remove(space.id, { requestId: createRequestId(), version: space.version });
    await app.api.books.remove(book.id, createRequestId()); libraryChanged();
  });
  const hidden = (await app.api.library.trash()).items.filter((item) => item.kind === 'book' || item.kind === 'space')
    .map((item) => `${item.kind}:${item.id}`).sort();
  const recycle = screen.getByRole('region', { name: '回收' });
  await within(recycle).findByText('归档');
  fireEvent.click(within(recycle).getByRole('button', { name: '清空' }));
  const confirm = screen.getByRole('alertdialog');
  expect(confirm.textContent).toContain('文件夹 1 个（含 1 个文件）');
  expect(confirm.textContent).not.toContain('空间');
  const batch = vi.spyOn(app.api.library, 'batch');
  const empty = vi.spyOn(app.api.library, 'emptyTrash');
  await act(async () => {
    await app.api.files.trash({ requestId: createRequestId(), path: '稍后.txt', confirmName: '稍后.txt' });
    libraryChanged();
  });
  await within(recycle).findByText('稍后.txt');
  fireEvent.click(within(confirm).getByRole('button', { name: '永久删除 1 项' }));
  await waitFor(() => expect(within(recycle).queryByText('归档')).toBeNull());
  expect(empty).not.toHaveBeenCalled();
  expect(batch.mock.calls[0]?.[0].items).toHaveLength(1);
  const remaining = (await app.api.library.trash()).items;
  expect(remaining.filter((item) => item.kind === 'book' || item.kind === 'space')
    .map((item) => `${item.kind}:${item.id}`).sort()).toEqual(hidden);
  expect(remaining.filter((item) => item.kind === 'file' || item.kind === 'folder')).toHaveLength(1);
  expect(remaining.find((item) => item.kind === 'file')?.title).toBe('稍后.txt');
});
