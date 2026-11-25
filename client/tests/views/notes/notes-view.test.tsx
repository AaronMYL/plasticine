import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toastStore } from '../../../src/primitives/toast/index.tsx';
import { NOW, renderApp, seedNote, settle } from '../../helpers.tsx';

function newNoteButton(): HTMLElement {
  return screen.getAllByRole('button', { name: window.innerWidth < 768 ? '新建' : '新建笔记' })[0]!;
}

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror');
    if (element?.editor === undefined) {
      throw new Error('编辑器还没出来');
    }
    return element.editor;
  });
}

describe('Notes page', () => {
  it('refetches body on restore event; keeps local draft and flags conflict when dirty', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 当前版本') });
    const editor = await noteEditor();
    const emit = vi.spyOn(app.control.bus, 'emit');
    emit.mockImplementationOnce(() => undefined);
    app.control.notes.externalEdit('n1', '# 恢复的正文');
    act(() => app.control.bus.emit({ type: 'note.invalidated', noteId: 'n1' }));
    await waitFor(() => expect(editor.getText()).toContain('恢复的正文'));
    act(() => editor.commands.insertContent('本地草稿'));
    emit.mockImplementationOnce(() => undefined);
    app.control.notes.externalEdit('n1', '# 再次恢复');
    act(() => app.control.bus.emit({ type: 'note.invalidated', noteId: 'n1' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('别处保存了新版本'), { timeout: 4000 });
    expect(editor.getText()).toContain('本地草稿');
  });
  it('groups list, opens first note on desktop by default, and renders body as Markdown', async () => {
    await renderApp({
      hash: '#/notes',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 这周的事\n\n- [ ] 第一件', { pinned: true });
        seedNote(fake, 'n2', '# 读书摘记\n\n一段话。', { updatedAt: new Date().toISOString() });
      },
    });
    await waitFor(() => expect(screen.getByRole('region', { name: '置顶' })).toBeTruthy());
    expect(screen.getByRole('region', { name: '今天' }).textContent).toContain('读书摘记');
    const editor = await noteEditor();
    expect(editor.getHTML()).toContain('<h1>这周的事</h1>');
    expect(editor.getHTML()).toContain('data-type="taskList"');
  });

  it('clicking another note updates route and body', async () => {
    await renderApp({
      hash: '#/notes',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 第一篇', { updatedAt: NOW.toISOString() });
        seedNote(fake, 'n2', '# 第二篇', { updatedAt: new Date(NOW.getTime() - 1000).toISOString() });
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^第二篇/ }));
    await settle();
    expect(window.location.hash).toBe('#/notes/n2');
    await waitFor(async () => expect((await noteEditor()).getText()).toContain('第二篇'));
  });

  it('autosaves after typing pause, transitioning status from Unsaved to Saved', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 计划') });
    const editor = await noteEditor();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent('，加一句');
    });
    expect(screen.getByLabelText(/^未保存/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/^已保存/)).toBeTruthy(), { timeout: 4000 });
    expect((await app.api.notes.get('n1')).markdown).toContain('加一句');
  });

  it('switching away and back preserves unsaved edits', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 第一篇');
        seedNote(fake, 'n2', '# 第二篇');
        fake.control.faults.next('save', { kind: 'failed', message: '断网了。' });
      },
    });
    const editor = await noteEditor();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent('没存上');
    });
    act(() => {
      window.location.hash = '#/notes/n2';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(async () => expect((await noteEditor()).getText()).toContain('第二篇'));
    act(() => {
      window.location.hash = '#/notes/n1';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(async () => expect((await noteEditor()).getText()).toContain('没存上'));
    expect(app.state.noteDrafts.get('n1')).toBeDefined();
  });

  it('external new version with local edits shows conflict banner; Use new version adopts it', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 原文') });
    const editor = await noteEditor();
    act(() => {
      app.control.notes.externalEdit('n1', '# 别处的版本');
    });
    await waitFor(() => expect(editor.getText()).toContain('别处的版本'));
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent('我的字');
      app.control.notes.externalEdit('n1', '# 第三版');
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('别处保存了新版本'), {
      timeout: 4000,
    });
    expect((await app.api.notes.get('n1')).markdown).toBe('# 第三版');
    fireEvent.click(screen.getByRole('button', { name: '用新版本' }));
    expect(editor.getText()).toContain('第三版');
  });

  it('delete moves immediately to Recently Deleted with undo toast that restores on click', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 要删的') });
    await noteEditor();
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(await app.api.notes.list({})).toHaveLength(0);
    await waitFor(() => expect(screen.getByText('还没有笔记。')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: '新建笔记' }).length).toBeGreaterThan(1);
    expect(screen.queryByRole('group', { name: '确认删除笔记' })).toBeNull();
    const toast = toastStore.get();
    expect(toast?.text).toBe('已把「要删的」移到最近删除');
    act(() => toast?.action?.run());
    await waitFor(() => expect(toastStore.get()?.text).toBe('「要删的」放回来了'));
    expect(await app.api.notes.list({})).toHaveLength(1);
  });

  it('renders legacy /v1 image URLs as /v2 while saving original Markdown verbatim', async () => {
    const markdown = '# 有图的\n\n![图](/v1/notes/assets/a1.png)';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', markdown) });
    const editor = await noteEditor();
    expect(document.querySelector('.ProseMirror img')?.getAttribute('src')).toBe('/v2/notes/assets/a1.png');
    expect(editor.getMarkdown()).toContain('/v1/notes/assets/a1.png');
  });

  it('double-clicking note image opens lightbox with gallery; single click shows Zoom action', async () => {
    const markdown = '# 有两张图\n\n![甲](/v2/notes/assets/a1.png)\n\n中间一段。\n\n![乙](/v2/notes/assets/a2.png)';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', markdown) });
    const editor = await noteEditor();
    const images = await waitFor(() => {
      const found = document.querySelectorAll<HTMLImageElement>('.ProseMirror .note-image img');
      if (found.length !== 2) { throw new Error('图还没画出来'); }
      return [...found];
    });
    fireEvent.doubleClick(images[1]!);
    const viewer = await screen.findByRole('dialog', { name: '看图' });
    expect(viewer.textContent).toContain('2 / 2');
    fireEvent.click(within(viewer).getByRole('button', { name: '关掉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '看图' })).toBeNull());
    expect(screen.queryByRole('button', { name: '放大' })).toBeNull();
    let first = -1;
    editor.state.doc.descendants((node, pos) => {
      if (first < 0 && node.type.name === 'image') { first = pos; }
    });
    act(() => { editor.commands.setNodeSelection(first); });
    fireEvent.click(await screen.findByRole('button', { name: '放大' }));
    expect((await screen.findByRole('dialog', { name: '看图' })).textContent).toContain('1 / 2');
    expect(editor.getMarkdown()).toContain('![甲](/v2/notes/assets/a1.png)');
  });

  it('single click opens image in read-only note', async () => {
    const markdown = '# 旧版导入\n\n![图](/v1/notes/assets/a1.png)';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', markdown, { readOnly: true }) });
    await noteEditor();
    const img = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>('.ProseMirror .note-image img');
      if (found === null) { throw new Error('图还没画出来'); }
      return found;
    });
    fireEvent.click(img);
    const viewer = await screen.findByRole('dialog', { name: '看图' });
    expect(within(viewer).getByRole('img', { name: '图' }).getAttribute('src')).toBe('/v2/notes/assets/a1.png');
  });

  it('read-only note disables editing and hides delete', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 旧版导入', { readOnly: true }) });
    const editor = await noteEditor();
    expect(editor.isEditable).toBe(false);
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '删除笔记' })).toBeNull();
  });

  it('creating a note opens it immediately and focuses the body', async () => {
    const app = await renderApp({ hash: '#/notes' });
    fireEvent.click(newNoteButton());
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const editor = await noteEditor();
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    expect(editor.isFocused).toBe(true);
    expect(app.state.notesUi.store.get().freshNoteId).toBeUndefined();
  });

  it.each([390, 1440])('%s 宽：新建后聚焦只发生一次，再打开同一篇不抢焦点', async (width) => {
    const app = await renderApp({ hash: '#/notes', width });
    fireEvent.click(newNoteButton());
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const editor = await noteEditor();
    const dom = editor.view.dom;
    await waitFor(() => expect(document.activeElement).toBe(dom));
    const id = window.location.hash.replace('#/notes/', '');
    fireEvent.click(width < 768 ? screen.getByRole('button', { name: '返回笔记列表' })
      : within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '首页' }));
    await settle();
    expect(document.activeElement).not.toBe(dom);
    await act(async () => {
      window.location.hash = `#/notes/${id}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const reopened = await noteEditor();
    await settle();
    expect(document.activeElement).not.toBe(reopened.view.dom);
    expect(app.state.notesUi.store.get().freshNoteId).toBeUndefined();
  });

  it('lost create receipt verifies with same requestId and opens created note without duplicating', async () => {
    const app = await renderApp({
      hash: '#/notes',
      setup: (fake) => fake.control.faults.next('create', { kind: 'uncertain', landed: true }),
    });
    const create = vi.spyOn(app.api.notes, 'create');
    fireEvent.click(newNoteButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const ids = create.mock.calls.map(([input]) => input.requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(await app.api.notes.list({})).toHaveLength(1);
  });

  it('re-clicking New after navigating away reuses same requestId for lost create receipt', async () => {
    const app = await renderApp({
      hash: '#/notes',
      setup: (fake) => fake.control.faults.next('create', { kind: 'uncertain', landed: false }),
    });
    const create = vi.spyOn(app.api.notes, 'create');
    fireEvent.click(newNoteButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '首页' }));
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '笔记' }));
    await settle();
    fireEvent.click(newNoteButton());
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const ids = create.mock.calls.map(([input]) => input.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(await app.api.notes.list({})).toHaveLength(1);
  });

  it('lost delete receipt shows pending verification, retries with same requestId, returns to list', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 要删的');
        fake.control.faults.next('remove', { kind: 'uncertain', landed: true });
      },
    });
    await noteEditor();
    const remove = vi.spyOn(app.api.notes, 'remove');
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    const ids = remove.mock.calls.map(([, requestId]) => requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('lost delete receipt that succeeded still shows Verify at top using same requestId on return', async () => {
    const app = await renderApp({
      hash: '#/notes/n1',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 要删的');
        seedNote(fake, 'n2', '# 留着的');
        fake.control.faults.next('remove', { kind: 'uncertain', landed: true });
      },
    });
    await noteEditor();
    const remove = vi.spyOn(app.api.notes, 'remove');
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    await waitFor(() => expect(screen.getByText(/删除一篇笔记的结果待核实/)).toBeTruthy());
    window.location.hash = '#/today';
    await waitFor(() => expect(screen.queryByText(/删除一篇笔记的结果待核实/)).toBeNull());
    window.location.hash = '#/notes';
    await waitFor(() => expect(screen.getByText(/删除一篇笔记的结果待核实/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(screen.queryByText(/删除一篇笔记的结果待核实/)).toBeNull());
    const ids = remove.mock.calls.map(([, requestId]) => requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('failed body fetch on version event shows Sync pending keeping draft and clears on retry', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 原文') });
    const editor = await noteEditor();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent('我的字');
    });
    app.control.faults.next('get', { kind: 'failed', message: '读不到。' });
    act(() => {
      app.control.notes.externalEdit('n1', '# 别处的版本');
    });
    await waitFor(() => expect(screen.getByText(/同步待核实/)).toBeTruthy());
    expect(editor.getText()).toContain('我的字');
    expect(app.state.noteDrafts.get('n1')?.markdown).toContain('我的字');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText(/同步待核实/)).toBeNull());
    expect(editor.getText()).toContain('我的字');
  });

  it('malformed note route (#/notes/%) renders shell and explains note cannot be opened', async () => {
    await renderApp({ hash: '#/notes/%', setup: (fake) => seedNote(fake, 'n1', '# 一篇') });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不完整'));
    expect(screen.getByRole('heading', { level: 1, name: '笔记' })).toBeTruthy();
  });

  it('empty search result shows Not found message', async () => {
    await renderApp({ hash: '#/notes', setup: (fake) => seedNote(fake, 'n1', '# 购物') });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索笔记' }), { target: { value: '时间' } });
    await waitFor(() => expect(screen.getByText('没找到「时间」。')).toBeTruthy());
  });

  it('mobile drills down from list to body with back navigation', async () => {
    await renderApp({ width: 390, hash: '#/notes', setup: (fake) => seedNote(fake, 'n1', '# 手机上的笔记') });
    expect(document.querySelector('.ProseMirror')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /^手机上的笔记/ }));
    await noteEditor();
    fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
    await settle();
    expect(window.location.hash).toBe('#/notes');
  });
});
