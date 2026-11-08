import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { NoteView } from '../../../src/api/types.ts';
import { NOTE_CACHE_STORAGE_KEY } from '../../../src/state/note-cache-storage.ts';
import { memoryStorage, renderApp, seedNote } from '../../helpers.tsx';

function editor(): Editor | undefined {
  return document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror')?.editor;
}

function navigate(id: string): void {
  act(() => {
    window.location.hash = `#/notes/${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

it('A→B→A 立即回显已打开的正文，短时间重复切换不再读取相同版本', async () => {
  let reads = 0;
  const delayed = Promise.withResolvers<NoteView>();
  const app = await renderApp({ hash: '#/notes/a', setup(fake) {
    seedNote(fake, 'a', '# 甲篇\n\n已经读过的内容');
    seedNote(fake, 'b', '# 乙篇\n\n另一篇内容');
    const get = fake.api.notes.get.bind(fake.api.notes);
    vi.spyOn(fake.api.notes, 'get').mockImplementation((id, signal) => {
      if (id === 'a' && ++reads > 1) { return delayed.promise; }
      return get(id, signal);
    });
  } });
  await waitFor(() => expect(editor()?.getText()).toContain('甲篇'));
  navigate('b');
  await waitFor(() => expect(editor()?.getText()).toContain('乙篇'));
  navigate('a');
  expect(editor()?.getText()).toContain('甲篇');
  expect(screen.queryByText('正在读…')).toBeNull();
  expect(reads).toBe(1);
  expect(app.state.noteDrafts.hasAny()).toBe(false);
});

it('切回有草稿的缓存正文后，后台新版不重建编辑器或覆盖未保存文字', async () => {
  const app = await renderApp({ hash: '#/notes/a', setup(fake) {
    seedNote(fake, 'a', '# 甲篇');
    seedNote(fake, 'b', '# 乙篇');
    fake.control.faults.next('save', { kind: 'failed', message: '暂时断网' });
  } });
  await waitFor(() => expect(editor()?.getText()).toContain('甲篇'));
  act(() => editor()?.commands.insertContent('未保存文字'));
  navigate('b');
  await waitFor(() => expect(editor()?.getText()).toContain('乙篇'));
  const pending = Promise.withResolvers<NoteView>();
  const get = app.api.notes.get.bind(app.api.notes);
  vi.spyOn(app.api.notes, 'get').mockImplementation((id, signal) => id === 'a' ? pending.promise : get(id, signal));
  act(() => app.control.notes.externalEdit('a', '# 来自另一处的新正文'));
  navigate('a');
  const current = editor();
  expect(current?.getText()).toContain('未保存文字');
  await act(async () => pending.resolve(await get('a')));
  expect(editor()).toBe(current);
  expect(current?.getText()).toContain('未保存文字');
  expect(current?.getText()).not.toContain('来自另一处');
  expect(app.state.noteDrafts.get('a')?.markdown).toContain('未保存文字');
});

it('页面重建从持久缓存立即恢复，再读到服务器新版；退出清缓存但保留未保存草稿', async () => {
  const storage = memoryStorage();
  const first = await renderApp({ storage, hash: '#/notes/a', setup: (fake) => seedNote(fake, 'a', '# 已缓存的正文') });
  await waitFor(() => expect(editor()?.getText()).toContain('已缓存的正文'));
  first.view.unmount();
  const pending = Promise.withResolvers<NoteView>();
  let fresh: NoteView | undefined;
  const second = await renderApp({ storage, hash: '#/notes/a', setup(fake) {
    seedNote(fake, 'a', '# 服务器的新正文', { version: 2 });
    const get = fake.api.notes.get.bind(fake.api.notes);
    vi.spyOn(fake.api.notes, 'get').mockImplementation(async (id, signal) => {
      fresh = await get(id, signal);
      return pending.promise;
    });
  } });
  expect(editor()?.getText()).toContain('已缓存的正文');
  await waitFor(() => expect(fresh).toBeDefined());
  await act(async () => pending.resolve(fresh!));
  await waitFor(() => expect(editor()?.getText()).toContain('服务器的新正文'));
  act(() => editor()?.commands.insertContent('本地未保存'));
  act(() => window.dispatchEvent(new Event('plasticine:logout')));
  expect(second.state.notesCache.store.get().size).toBe(0);
  expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).toBeNull();
  expect(second.state.noteDrafts.get('a')?.markdown).toContain('本地未保存');
});

it('401 清除正文缓存，未通过会话核实时不会从本机缓存展示笔记', async () => {
  const storage = memoryStorage();
  const app = await renderApp({ storage, hash: '#/notes/a', setup: (fake) => seedNote(fake, 'a', '# 正文') });
  await waitFor(() => expect(editor()?.getText()).toContain('正文'));
  expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).not.toBeNull();
  await act(async () => {
    app.control.session.expire();
    await expect(app.api.notes.get('a')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
  expect(app.state.notesCache.store.get().size).toBe(0);
  expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).toBeNull();
  expect(editor()).toBeUndefined();
});

it('组合输入中的远端更新在组合结束后接入，不要求再移动一次光标', async () => {
  const app = await renderApp({ hash: '#/notes/a', setup: (fake) => seedNote(fake, 'a', '# 原正文') });
  await waitFor(() => expect(editor()?.getText()).toContain('原正文'));
  const current = editor()!;
  fireEvent.compositionStart(current.view.dom);
  act(() => app.control.notes.externalEdit('a', '# 组合期间的新正文'));
  await waitFor(() => expect(app.state.notesCache.store.get().get('a')?.note?.version).toBe(2));
  expect(current.getText()).toContain('原正文');
  fireEvent.compositionEnd(current.view.dom);
  await waitFor(() => expect(current.getText()).toContain('组合期间的新正文'));
});

it('v3先到、v2保存回执后到：保存明确完成后接入v3且不倒退缓存', async () => {
  const app = await renderApp({ hash: '#/notes/a', setup: (fake) => seedNote(fake, 'a', '# 原正文') });
  await waitFor(() => expect(editor()?.getText()).toContain('原正文'));
  const pending = Promise.withResolvers<NoteView>();
  let written: NoteView | undefined;
  const save = app.api.notes.save.bind(app.api.notes);
  vi.spyOn(app.api.notes, 'save').mockImplementation(async (id, input) => {
    written = await save(id, input);
    return pending.promise;
  });
  act(() => editor()?.chain().focus('end').insertContent('，本地输入').run());
  await waitFor(() => expect(written).toBeDefined(), { timeout: 4000 });
  act(() => app.control.notes.externalEdit('a', `${written!.markdown}\n\n后续的远端追加`));
  await waitFor(() => expect(app.state.notesCache.store.get().get('a')?.note?.version).toBe(3));
  expect(editor()?.getText()).not.toContain('后续的远端追加');
  await act(async () => pending.resolve(written!));
  await waitFor(() => expect(editor()?.getText()).toContain('后续的远端追加'));
  expect(editor()?.getText()).toContain('本地输入');
  expect(app.state.notesCache.store.get().get('a')?.note?.version).toBe(3);
  expect(app.state.noteDrafts.hasAny()).toBe(false);
});
