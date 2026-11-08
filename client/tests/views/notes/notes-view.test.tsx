import type { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NOW, renderApp, seedNote, settle } from '../../helpers.tsx';

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror');
    if (element?.editor === undefined) {
      throw new Error('编辑器还没出来');
    }
    return element.editor;
  });
}

describe('笔记页', () => {
  it('收到恢复通知后重读当前正文；有本地草稿时保留草稿并提示冲突', async () => {
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
  it('列表分组显示，电脑上默认打开第一篇，正文按 Markdown 显示', async () => {
    await renderApp({
      hash: '#/notes',
      setup: (fake) => {
        seedNote(fake, 'n1', '# 这周的事\n\n- [ ] 第一件', { pinned: true });
        // 列表按真实的「现在」分组，所以这一篇用此刻的时间。
        seedNote(fake, 'n2', '# 读书摘记\n\n一段话。', { updatedAt: new Date().toISOString() });
      },
    });
    await waitFor(() => expect(screen.getByRole('region', { name: '置顶' })).toBeTruthy());
    expect(screen.getByRole('region', { name: '今天' }).textContent).toContain('读书摘记');
    const editor = await noteEditor();
    expect(editor.getHTML()).toContain('<h1>这周的事</h1>');
    expect(editor.getHTML()).toContain('data-type="taskList"');
  });

  it('点列表里另一篇，地址和正文跟着换', async () => {
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

  it('写字后停笔自动保存，状态从「未保存」到「已保存」', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 计划') });
    const editor = await noteEditor();
    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent('，加一句');
    });
    expect(screen.getByText('未保存')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy(), { timeout: 4000 });
    expect((await app.api.notes.get('n1')).markdown).toContain('加一句');
  });

  it('切到另一篇再切回来，没存上的字还在', async () => {
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

  it('别处保存了新版本、我又改了：出冲突横幅，不覆盖；「用新版本」换上新版', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 原文') });
    const editor = await noteEditor();
    act(() => {
      app.control.notes.externalEdit('n1', '# 别处的版本');
    });
    await waitFor(() => expect(editor.getText()).toContain('别处的版本'));
    // 这一次在别处又存了一版，但编辑器这边先写了字
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

  it('删除要点两次，移到最近删除后回到列表', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 要删的') });
    await noteEditor();
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近删除' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(await app.api.notes.list({})).toHaveLength(0);
    await waitFor(() => expect(screen.getByText('还没有笔记。')).toBeTruthy());
  });

  it('迁过来的笔记里旧的 /v1 图片地址画成 /v2 的，存回去的 Markdown 一字不改', async () => {
    const markdown = '# 有图的\n\n![图](/v1/notes/assets/a1.png)';
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', markdown) });
    const editor = await noteEditor();
    expect(document.querySelector('.ProseMirror img')?.getAttribute('src')).toBe('/v2/notes/assets/a1.png');
    expect(editor.getMarkdown()).toContain('/v1/notes/assets/a1.png');
  });

  it('只读笔记不能编辑，也没有删除', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 旧版导入', { readOnly: true }) });
    const editor = await noteEditor();
    expect(editor.isEditable).toBe(false);
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '删除笔记' })).toBeNull();
  });

  it('新建一篇，打开的就是它，焦点直接落在正文里（审查第 3 条）', async () => {
    const app = await renderApp({ hash: '#/notes' });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const editor = await noteEditor();
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    expect(editor.isFocused).toBe(true);
    expect(app.state.notesUi.store.get().freshNoteId).toBeUndefined();
  });

  it.each([390, 1440])('%s 宽：新建后聚焦只发生一次，再打开同一篇不抢焦点', async (width) => {
    const app = await renderApp({ hash: '#/notes', width });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const editor = await noteEditor();
    const dom = editor.view.dom;
    await waitFor(() => expect(document.activeElement).toBe(dom));
    const id = window.location.hash.replace('#/notes/', '');
    fireEvent.click(width < 768 ? screen.getByRole('button', { name: '返回笔记列表' })
      : within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '现在' }));
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

  it('新建回执丢了（其实建上了）：点「再核实」用同一个 requestId，打开的是那一篇，不建第二篇', async () => {
    const app = await renderApp({
      hash: '#/notes',
      setup: (fake) => fake.control.faults.next('create', { kind: 'uncertain', landed: true }),
    });
    const create = vi.spyOn(app.api.notes, 'create');
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const ids = create.mock.calls.map(([input]) => input.requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(await app.api.notes.list({})).toHaveLength(1);
  });

  it('新建回执丢了，切走再回来再点「新建」：还是同一个 requestId', async () => {
    const app = await renderApp({
      hash: '#/notes',
      setup: (fake) => fake.control.faults.next('create', { kind: 'uncertain', landed: false }),
    });
    const create = vi.spyOn(app.api.notes, 'create');
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '现在' }));
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '笔记' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/note_/));
    const ids = create.mock.calls.map(([input]) => input.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(await app.api.notes.list({})).toHaveLength(1);
  });

  it('删除回执丢了：写「结果待核实」，点「再核实」用同一个 requestId，回到列表', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '移到最近删除' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    const ids = remove.mock.calls.map(([, requestId]) => requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('删除回执丢了（其实删掉了）、切走再回来：那一篇已不在列表里，笔记页顶上仍能「再核实」，用同一个 requestId', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '移到最近删除' }));
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

  it('收到新版本通知但读正文失败：显示「同步待核实」，本地草稿还在；点「重试」读到后提示消失', async () => {
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

  it('地址里笔记标识不完整（#/notes/%）：壳照常渲染，写明打不开', async () => {
    await renderApp({ hash: '#/notes/%', setup: (fake) => seedNote(fake, 'n1', '# 一篇') });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不完整'));
    expect(screen.getByRole('heading', { level: 1, name: '笔记' })).toBeTruthy();
  });

  it('搜索没有结果时说「没有找到」', async () => {
    await renderApp({ hash: '#/notes', setup: (fake) => seedNote(fake, 'n1', '# 购物') });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索笔记' }), { target: { value: '时间' } });
    await waitFor(() => expect(screen.getByText('没有找到。')).toBeTruthy());
  });

  it('手机上一层一层进：列表 → 正文，带返回', async () => {
    await renderApp({ width: 390, hash: '#/notes', setup: (fake) => seedNote(fake, 'n1', '# 手机上的笔记') });
    expect(document.querySelector('.ProseMirror')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /^手机上的笔记/ }));
    await noteEditor();
    fireEvent.click(screen.getByRole('button', { name: '返回笔记列表' }));
    await settle();
    expect(window.location.hash).toBe('#/notes');
  });
});
