// 2026-11-05 第 10 条「切笔记时文件夹闪一下」：切笔记时整个笔记页按路由重挂（shell.tsx 的 boundaryKey 带着笔记 id），
// 文件夹列表以前每次从空开始重拉——先画出「全部 0」、文件夹那组空着，拉回来再整列换上。现在列表在共享缓存里
// （state/note-folders-cache.ts），重挂的第一帧就是上次的列表，后台拉回来一样就不换。
// 第 11 条：文件夹里不再列「已合并（原版）」，原版从合并后那篇的「合并 n 份原版」里照样能打开；「全部」照旧含原版。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteFoldersCache } from '../../../src/state/note-folders-cache.ts';
import { NotesUi } from '../../../src/state/notes-ui.ts';
import { memoryStorage, renderApp, seedNote } from '../../helpers.tsx';

function folderColumn(): HTMLElement {
  return screen.getByRole('complementary', { name: '笔记文件夹' });
}

describe('切笔记时文件夹不闪', () => {
  it('切到另一篇：文件夹在第二栏不重挂，列表照旧，不先变成「全部 0」', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 第一篇', { folder: '工作' });
      seedNote(fake, 'n2', '# 第二篇', { folder: '工作' });
    } });
    await within(folderColumn()).findByRole('button', { name: '工作 2' });
    const before = folderColumn();
    // 拉文件夹的请求先挂着：切过去的第一帧只能来自缓存。
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof app.api.notes.folders>>>();
    const folders = vi.spyOn(app.api.notes, 'folders').mockReturnValue(gate.promise);
    act(() => { window.location.hash = '#/notes/n2'; });
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('第二篇'));
    // 11-07 起文件夹在第二栏：切笔记时整列不重挂（还是同一个节点），列表照旧。
    expect(folderColumn()).toBe(before);
    expect(within(folderColumn()).getByRole('button', { name: '全部 2' })).toBeTruthy();
    expect(within(folderColumn()).getByRole('button', { name: '工作 2' })).toBeTruthy();
    folders.mockRestore();
  });

  it('后台拉回来的和手上的一样：不换列表（订阅的组件不重画）', async () => {
    const view = { folders: [{ name: '笔记', count: 1, fixed: true }], allCount: 1, deletedCount: 0, mergedCount: 0 };
    const api = { folders: vi.fn(async () => structuredClone(view)) };
    const cache = new NoteFoldersCache(api);
    const hub = { on: () => () => undefined };
    const release = cache.observe(hub);
    await waitFor(() => expect(cache.store.get().folders).not.toBeNull());
    const first = cache.store.get();
    const changed = vi.fn();
    const off = cache.store.subscribe(changed);
    await cache.load();
    expect(cache.store.get()).toBe(first);
    expect(changed).not.toHaveBeenCalled();
    api.folders.mockResolvedValueOnce({ ...structuredClone(view), allCount: 2 });
    await cache.load();
    expect(cache.store.get().folders?.allCount).toBe(2);
    expect(changed).toHaveBeenCalledTimes(1);
    off();
    release();
  });

  it('读不到时保留上次的列表，只多一句原因', async () => {
    const view = { folders: [{ name: '笔记', count: 1, fixed: true }], allCount: 1, deletedCount: 0, mergedCount: 0 };
    const api = { folders: vi.fn(async () => structuredClone(view)) };
    const cache = new NoteFoldersCache(api);
    await cache.load();
    api.folders.mockRejectedValueOnce(new Error('连接断了'));
    await cache.load();
    expect(cache.store.get().folders?.allCount).toBe(1);
    expect(cache.store.get().error).toContain('连接断了');
  });
});

describe('不再列「已合并（原版）」', () => {
  it('文件夹里没有这一行；原版从合并后那篇的「合并 n 份原版」打开；「全部」照旧含原版', async () => {
    const app = await renderApp({ hash: '#/notes/merged', setup: (fake) => {
      seedNote(fake, 'merged', '# 合并后的', { folder: '工作' });
      seedNote(fake, 'old', '# 合并前的原版', { folder: '已合并（原版）' });
      fake.control.notes.importViews.set('merged', { variants: [], mergedInto: null, originalIds: ['old'],
        links: [{ id: 'old', title: '合并前的原版' }] });
    } });
    await within(folderColumn()).findByRole('button', { name: '全部 2' });
    expect(within(folderColumn()).queryByRole('button', { name: /已合并/ })).toBeNull();
    expect(within(folderColumn()).queryByText(/已合并/)).toBeNull();
    fireEvent.click(await screen.findByText('合并 1 份原版'));
    fireEvent.click(screen.getByRole('link', { name: '《合并前的原版》' }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('合并前的原版'));
    expect(app.state.notesUi.store.get().collection).toEqual({ kind: 'all' });
  });

  it('以前停在「已合并（原版）」的，打开时回到「全部」', () => {
    const storage = memoryStorage();
    storage.setItem('plasticine:notes-ui', JSON.stringify({ query: '', collection: { kind: 'folder',
      name: '已合并（原版）' }, foldersHidden: false, listHidden: false, predict: true, interject: false }));
    expect(new NotesUi(storage).store.get().collection).toEqual({ kind: 'all' });
    storage.setItem('plasticine:notes-ui', JSON.stringify({ query: '', collection: { kind: 'folder',
      name: '工作' }, foldersHidden: false, listHidden: false, predict: true, interject: false }));
    expect(new NotesUi(storage).store.get().collection).toEqual({ kind: 'folder', name: '工作' });
  });
});
