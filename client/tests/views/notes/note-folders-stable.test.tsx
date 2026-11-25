import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteFoldersCache } from '../../../src/state/note-folders-cache.ts';
import { NotesUi } from '../../../src/state/notes-ui.ts';
import { memoryStorage, renderApp, seedNote } from '../../helpers.tsx';
import { noteColumn, openFolders } from './folders.ts';

describe('Folders do not flicker when switching notes', () => {
  it('switching note keeps second column mounted and folder list intact without flashing All 0', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 第一篇', { folder: '工作' });
      seedNote(fake, 'n2', '# 第二篇', { folder: '工作' });
    } });
    await within(await openFolders()).findByRole('button', { name: '工作 2' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '文件夹' })).toBeNull());
    const before = noteColumn();
    const list = before.querySelector('.note-list');
    const gate = Promise.withResolvers<Awaited<ReturnType<typeof app.api.notes.folders>>>();
    const folders = vi.spyOn(app.api.notes, 'folders').mockReturnValue(gate.promise);
    act(() => { window.location.hash = '#/notes/n2'; });
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('第二篇'));
    expect(noteColumn()).toBe(before);
    expect(before.querySelector('.note-list')).toBe(list);
    const reopened = await openFolders();
    expect(within(reopened).getByRole('button', { name: '全部 2' })).toBeTruthy();
    expect(within(reopened).getByRole('button', { name: '工作 2' })).toBeTruthy();
    folders.mockRestore();
  });

  it('identical background folder fetch keeps list reference so subscribers do not re-render', async () => {
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

  it('preserves previous folder list with error reason when fetch fails', async () => {
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

describe('No longer lists Merged (originals)', () => {
  it('omits Merged folder row; originals open from merged note link while All still includes them', async () => {
    const app = await renderApp({ hash: '#/notes/merged', setup: (fake) => {
      seedNote(fake, 'merged', '# 合并后的', { folder: '工作' });
      seedNote(fake, 'old', '# 合并前的原版', { folder: '已合并（原版）' });
      fake.control.notes.importViews.set('merged', { variants: [], mergedInto: null, originalIds: ['old'],
        links: [{ id: 'old', title: '合并前的原版' }] });
    } });
    const folders = await openFolders();
    await within(folders).findByRole('button', { name: '全部 2' });
    expect(within(folders).queryByRole('button', { name: /已合并/ })).toBeNull();
    expect(within(folders).queryByText(/已合并/)).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByText('合并 1 份原版'));
    fireEvent.click(screen.getByRole('link', { name: '《合并前的原版》' }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('合并前的原版'));
    expect(app.state.notesUi.store.get().collection).toEqual({ kind: 'all' });
  });

  it('previously selected Merged (originals) folder falls back to All on open', () => {
    const storage = memoryStorage();
    storage.setItem('plasticine:notes-ui', JSON.stringify({ query: '', collection: { kind: 'folder',
      name: '已合并（原版）' }, foldersHidden: false, listHidden: false, predict: true, interject: false }));
    expect(new NotesUi(storage).store.get().collection).toEqual({ kind: 'all' });
    storage.setItem('plasticine:notes-ui', JSON.stringify({ query: '', collection: { kind: 'folder',
      name: '工作' }, foldersHidden: false, listHidden: false, predict: true, interject: false }));
    expect(new NotesUi(storage).store.get().collection).toEqual({ kind: 'folder', name: '工作' });
  });
});
