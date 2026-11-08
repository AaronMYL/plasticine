import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NotesUi } from '../../../src/state/notes-ui.ts';
import { AUTOSAVE_DELAY_MS } from '../../../src/views/notes/note-saver.ts';
import { memoryStorage, renderApp, seedNote, settle } from '../../helpers.tsx';

it('纯阅读和选中文字不会把编辑器补的空段落写回原文或增加笔记版本', async () => {
  const markdown = '# 只打开阅读\n\n- [ ] 保留原样的待办';
  const saves = vi.fn();
  const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
    seedNote(fake, 'n1', markdown);
    const save = fake.api.notes.save.bind(fake.api.notes);
    vi.spyOn(fake.api.notes, 'save').mockImplementation((id, input) => {
      saves();
      return save(id, input);
    });
  } });
  const editor = await waitFor(() => {
    const current = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror')?.editor;
    if (current === undefined) throw new Error('编辑器尚未就绪');
    return current;
  });
  act(() => { editor.commands.setTextSelection({ from: 2, to: 4 }); });
  await settle(AUTOSAVE_DELAY_MS + 100);
  expect(saves).not.toHaveBeenCalled();
  expect((await app.api.notes.get('n1'))).toMatchObject({ version: 1, markdown });
  expect(app.state.noteDrafts.get('n1')).toBeUndefined();
  expect(screen.getByText('已保存')).toBeTruthy();
});

it('新建回执迟到时保存创建结果，但用户已离开的页面不被拉回笔记', async () => {
  const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 原笔记') });
  await screen.findByRole('textbox', { name: '笔记正文' });
  const gate = Promise.withResolvers<void>();
  const original = app.api.notes.create.bind(app.api.notes);
  const create = vi.spyOn(app.api.notes, 'create').mockImplementationOnce(async (input) => {
    await gate.promise;
    return original(input);
  });
  fireEvent.click(screen.getByRole('button', { name: '新建' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '现在' }));
  await waitFor(() => expect(window.location.hash).toBe('#/today'));
  await act(async () => gate.resolve());
  expect(window.location.hash).toBe('#/today');
  expect(await app.api.notes.list({})).toHaveLength(2);
});

it('删除已生效而回执迟到，打开另一篇后仍停留在新笔记', async () => {
  const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
    seedNote(fake, 'n1', '# 待删除'); seedNote(fake, 'n2', '# 正在阅读的另一篇');
  } });
  await screen.findByRole('textbox', { name: '笔记正文' });
  const gate = Promise.withResolvers<void>();
  const original = app.api.notes.remove.bind(app.api.notes);
  const remove = vi.spyOn(app.api.notes, 'remove').mockImplementationOnce(async (id, requestId) => {
    const result = await original(id, requestId);
    await gate.promise;
    return result;
  });
  fireEvent.click(screen.getByLabelText('更多笔记操作'));
  fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
  fireEvent.click(screen.getByRole('button', { name: '移到最近删除' }));
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  act(() => { window.location.hash = '#/notes/n2'; });
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('正在阅读的另一篇'));
  await act(async () => gate.resolve());
  expect(window.location.hash).toBe('#/notes/n2');
});

// 首页的「最近阅读」第 2 批（2026-11-04 设计稿 Main）拿掉了：首页只有 回来汇报 · 等你 · 在做；它的两条核实测试随之去掉。
