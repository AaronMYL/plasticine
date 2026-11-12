import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { uncertainError } from '../../../src/api/errors.ts';
import { ActionOps } from '../../../src/state/action-ops.ts';
import { memoryStorage, renderApp, seedNote, settle } from '../../helpers.tsx';
import { aiOn, toggleAi } from './ai-switch.ts';

async function editor(): Promise<Editor> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement & { editor?: Editor }>('.ProseMirror');
    if (node?.editor === undefined) { throw new Error('编辑器尚未就绪'); }
    return node.editor;
  });
}

describe('笔记完整工作区', () => {
  it('文件夹改名落地但回执丢失，切页后用原请求核实；快速重复不再改一遍', async () => {
    const storage = memoryStorage();
    const app = await renderApp({ hash: '#/notes/n1', storage, setup: (fake) => {
      seedNote(fake, 'n1', '# 出行', { folder: '旧文件夹' });
    } });
    await editor();
    fireEvent.click(await screen.findByRole('button', { name: '管理文件夹旧文件夹' }));
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新文件夹' } });
    const original = app.api.notes.changeFolder.bind(app.api.notes);
    const write = vi.spyOn(app.api.notes, 'changeFolder').mockImplementationOnce(async (input) => {
      await original(input);
      throw uncertainError('改文件夹', '改名已落地，回执丢失');
    });
    const save = screen.getByRole('button', { name: '保存名称' });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText(/改名已落地，回执丢失/);
    expect(write).toHaveBeenCalledTimes(1);
    act(() => { window.location.hash = '#/today'; });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '笔记文件夹' })).toBeNull());
    act(() => { window.location.hash = '#/notes/n1'; });
    const retry = await screen.findByRole('button', { name: '再核实' });
    const persisted = new ActionOps(storage).get('note-folders:change');
    expect(persisted?.request).toMatchObject({ kind: 'note_folder', body: write.mock.calls[0]?.[0] });
    fireEvent.click(retry);
    await waitFor(() => expect(app.state.actionOps.get('note-folders:change')).toBeUndefined());
    expect(write.mock.calls[1]?.[0]).toEqual(write.mock.calls[0]?.[0]);
    const current = await app.api.notes.get('n1');
    expect(current.folder).toBe('新文件夹');
    expect(current.version).toBe(2);
    expect(await screen.findByRole('button', { name: '新文件夹 1' })).toBeTruthy();
  });

  it('文件夹计数先读到新事件，迟到的旧列表不能覆盖它', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 一', { folder: '工作' });
    } });
    await screen.findByRole('button', { name: '工作 1' });
    const old = await app.api.notes.folders();
    const gate = Promise.withResolvers<typeof old>();
    vi.spyOn(app.api.notes, 'folders').mockReturnValueOnce(gate.promise);
    act(() => app.control.bus.emit({ type: 'note.invalidated', noteId: 'folders' }));
    act(() => {
      seedNote(app, 'n2', '# 二', { folder: '工作' });
      app.control.bus.emit({ type: 'note.invalidated', noteId: 'folders' });
    });
    await screen.findByRole('button', { name: '工作 2' });
    await act(async () => gate.resolve(old));
    expect(screen.getByRole('button', { name: '工作 2' })).toBeTruthy();
  });

  it('文件夹新建、移入、软删后恢复回原文件夹，正文深处能搜索', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', `# 旅行\n\n${'普通内容'.repeat(60)}\n正文深处的杭州`, { folder: '出行' });
    } });
    await editor();
    expect(await screen.findByRole('button', { name: '出行 1' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索笔记' }), { target: { value: '杭州' } });
    await settle(300);
    expect(document.querySelectorAll('.note-row')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('更多笔记操作'));
    fireEvent.click(screen.getByRole('button', { name: '删除笔记' }));
    fireEvent.click(screen.getByRole('button', { name: '移到最近删除' }));
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    fireEvent.click(await screen.findByRole('button', { name: '最近删除 1' }));
    await settle(350);
    fireEvent.click(await screen.findByRole('button', { name: /旅行/ }));
    await editor();
    fireEvent.click(await screen.findByRole('button', { name: '恢复笔记' }));
    await waitFor(async () => expect((await app.api.notes.get('n1')).deletedAt).toBeNull());
    expect((await app.api.notes.get('n1')).folder).toBe('出行');
  });

  it('恢复已落地但回执丢失，恢复按钮消失后切页仍能核实原操作', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 已删除原文', { folder: '旅行', deletedAt: '2026-10-30T12:00:00.000Z' });
    } });
    await editor();
    const original = app.api.notes.restore.bind(app.api.notes);
    const restore = vi.spyOn(app.api.notes, 'restore').mockImplementationOnce(async (id, requestId) => {
      await original(id, requestId);
      throw uncertainError('恢复笔记', '已经恢复，响应丢失');
    });
    fireEvent.click(await screen.findByRole('button', { name: '恢复笔记' }));
    await waitFor(() => expect(app.state.noteOps.get('restore:n1')?.status).toBe('uncertain'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复笔记' })).toBeNull());
    act(() => { window.location.hash = '#/today'; });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '笔记文件夹' })).toBeNull());
    act(() => { window.location.hash = '#/notes/n1'; });
    fireEvent.click(await screen.findByRole('button', { name: '再核实' }));
    await waitFor(() => expect(app.state.noteOps.get('restore:n1')).toBeUndefined());
    expect(restore.mock.calls[1]).toEqual(restore.mock.calls[0]);
    const current = await app.api.notes.get('n1');
    expect(current.deletedAt).toBeNull();
    expect(current.folder).toBe('旅行');
    expect(current.markdown).toBe('# 已删除原文');
    expect(current.version).toBe(2);
  });

  it('恢复先收到事件，用户开始另一篇笔记后迟到回执不覆盖新导航', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 从回收站恢复', { deletedAt: '2026-10-30T12:00:00.000Z' });
    } });
    await editor();
    const original = app.api.notes.restore.bind(app.api.notes);
    const gate = Promise.withResolvers<void>();
    vi.spyOn(app.api.notes, 'restore').mockImplementationOnce(async (id, requestId) => {
      const note = await original(id, requestId);
      await gate.promise;
      return note;
    });
    fireEvent.click(await screen.findByRole('button', { name: '恢复笔记' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复笔记' })).toBeNull());
    act(() => { window.location.hash = '#/notes/new'; });
    await waitFor(() => expect(window.location.hash).not.toBe('#/notes/new'));
    const hash = window.location.hash;
    expect(hash).not.toBe('#/notes/n1');
    await act(async () => gate.resolve());
    expect(window.location.hash).toBe(hash);
    expect(await app.api.notes.list({})).toHaveLength(2);
  });

  it('直达新建只建一篇；格式工具可插待办、表格和可编辑图表', async () => {
    const app = await renderApp({ hash: '#/notes/new' });
    const noteEditor = await editor();
    expect(window.location.hash).not.toBe('#/notes/new');
    expect(await app.api.notes.list({})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '待办' }));
    expect(noteEditor.getHTML()).toContain('taskList');
    fireEvent.click(screen.getByRole('button', { name: '表格' }));
    expect(noteEditor.getHTML()).toContain('<table');
    fireEvent.click(screen.getByRole('button', { name: '图表' }));
    expect(await screen.findByRole('img', { name: '示例图表' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '改数据' }));
    fireEvent.change(screen.getByRole('textbox', { name: '图表数据' }), {
      target: { value: '{"type":"line","title":"进展","labels":["甲","乙"],"values":[2,3]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存图表' }));
    expect(await screen.findByRole('img', { name: '进展' })).toBeTruthy();
  });

  it('AI 修改先对照，逐处采用期间继续打字不会被整篇覆盖', async () => {
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', '# 原题\n\n甲段\n\n乙段') });
    vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '# 原题\n\n甲段改\n\n乙段改', label: '润色' });
    const noteEditor = await editor();
    fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '整篇润色' }));
    const review = await screen.findByRole('region', { name: '笔记改动对照' });
    expect(noteEditor.getText()).not.toContain('甲段改');
    const options = within(review).getAllByRole('checkbox');
    expect(options.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(options[1]!);
    act(() => noteEditor.commands.insertContentAt(noteEditor.state.doc.content.size, '<p>新写的一句</p>'));
    fireEvent.click(within(review).getByRole('button', { name: '采用所选' }));
    expect(noteEditor.getText()).toContain('甲段改');
    expect(noteEditor.getText()).not.toContain('乙段改');
    expect(noteEditor.getText()).toContain('新写的一句');
  });

  it('多图上传后半失败，继续打字后重试只补剩下的图片，已插入的不重复', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 图文') });
    const noteEditor = await editor();
    const upload = vi.spyOn(app.api.notes, 'uploadImage')
      .mockResolvedValueOnce({ url: '/v2/notes/assets/first.png', bytes: 1 })
      .mockRejectedValueOnce(new Error('第二张暂时上传失败'))
      .mockResolvedValueOnce({ url: '/v2/notes/assets/second.png', bytes: 1 });
    act(() => noteEditor.commands.focus('end'));
    fireEvent.change(screen.getByLabelText('上传笔记图片'), { target: {
      files: [new File(['1'], 'first.png', { type: 'image/png' }),
        new File(['2'], 'second.png', { type: 'image/png' })],
    } });
    await screen.findByRole('button', { name: '重试上传' });
    expect(noteEditor.getHTML().match(/<img /g)).toHaveLength(1);
    act(() => noteEditor.commands.insertContentAt(1, '新写的字'));
    fireEvent.click(screen.getByRole('button', { name: '重试上传' }));
    await waitFor(() => expect(noteEditor.getHTML().match(/<img /g)).toHaveLength(2));
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2]?.[1].requestId).toBe(upload.mock.calls[1]?.[1].requestId);
    expect(noteEditor.getText()).toContain('新写的字');
  });

  it('置顶回执丢失，切页回来核实仍用同一请求，不会再翻转一次', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 正文');
      fake.control.faults.next('save', { kind: 'uncertain', landed: true });
    } });
    await editor();
    const save = vi.spyOn(app.api.notes, 'save');
    fireEvent.click(screen.getByRole('button', { name: '更多笔记操作' }));
    const menu = screen.getByRole('dialog', { name: '更多笔记操作' });
    fireEvent.click(within(menu).getByRole('button', { name: '置顶' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await within(menu).findByText(/结果待核实/);
    act(() => { window.location.hash = '#/today'; });
    await waitFor(() => expect(document.querySelector('.note-meta')).toBeNull());
    // 切页时笔记 ⋯ 跟着收起（use-dismiss.ts）。
    expect(screen.queryByRole('dialog', { name: '更多笔记操作' })).toBeNull();
    act(() => { window.location.hash = '#/notes/n1'; });
    await editor();
    fireEvent.click(screen.getByRole('button', { name: '更多笔记操作' }));
    const nextMenu = screen.getByRole('dialog', { name: '更多笔记操作' });
    fireEvent.click(within(nextMenu).getByRole('button', { name: '再核实原操作' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[1]).toEqual(save.mock.calls[0]?.[1]);
    expect((await app.api.notes.get('n1')).pinned).toBe(true);
    expect((await app.api.notes.get('n1')).version).toBe(2);
  });
});

describe('笔记协作与导入', () => {
  it('预测呈灰字，Tab采用；继续输入取消在途请求，迟到结果不写入', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 思路\n\n正在想一件事情') });
    const noteEditor = await editor();
    act(() => noteEditor.commands.focus('end'));
    expect(aiOn('续写')).toBe(true);
    await waitFor(() => expect(document.querySelector('.note-ghost')?.textContent).toBe('，再想一步。'), { timeout: 3000 });
    fireEvent.keyDown(noteEditor.view.dom, { key: 'Tab' });
    expect(noteEditor.getText()).toContain('再想一步');
    expect(document.querySelector('.note-ghost')).toBeNull();
    let finish: ((value: { markdown: string; label: string }) => void) | undefined;
    let signal: AbortSignal | undefined;
    const suggest = vi.spyOn(app.api.notes, 'assist').mockImplementationOnce((_id, _input, requestedSignal) => {
      signal = requestedSignal;
      return new Promise((resolve) => { finish = resolve; });
    });
    act(() => noteEditor.commands.insertContent('先写一点'));
    await waitFor(() => expect(suggest).toHaveBeenCalled(), { timeout: 3000 });
    act(() => noteEditor.commands.insertContent('后来改主意'));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish?.({ markdown: '过时建议', label: '续写' }));
    expect(noteEditor.getText()).not.toContain('过时建议');
    expect(document.querySelector('.note-ghost')).toBeNull();
    toggleAi('续写');
  });

  it('补充只在停笔后出现，加上先预览、留下才写入', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 研究') });
    const noteEditor = await editor();
    toggleAi('补充建议');
    act(() => noteEditor.chain().focus('end').insertContent('思考内容'.repeat(25)).run());
    expect(document.querySelector('.note-suggestion')).toBeNull();
    await waitFor(() => expect(document.querySelector('.note-body .note-suggestion')).not.toBeNull(),
      { timeout: 5000 });
    expect(document.querySelector('.note-command-bar .note-suggestion')).toBeNull();
    expect(screen.queryByText('Plasticine 想接一句')).toBeNull();
    expect(noteEditor.getText()).not.toContain('具体时间：');
    const suggestion = document.querySelector<HTMLElement>('.note-body .note-suggestion')!;
    fireEvent.click(within(suggestion).getAllByRole('button', { name: '加上' })[1]!);
    expect(noteEditor.getText()).not.toContain('具体时间：');
    fireEvent.click(screen.getByRole('button', { name: '留下' }));
    expect(noteEditor.getText()).toContain('具体时间：[待确认]。');
  });

  it('导入三版按原文对照，合并原版与结果互链；缺失来源不会制造链接', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => {
      seedNote(fake, 'n1', '# 正文', { migrated: true });
      fake.control.notes.importViews.set('n1', {
        variants: [{ kind: 'original', markdown: '# 原文\n错字' }, { kind: 'corrected', markdown: '# 原文\n对字' },
          { kind: 'polished', markdown: '# 原文\n清楚的一句' }],
        mergedInto: 'n2', originalIds: ['n3'], links: [{ id: 'n2', title: '合并结果' }, { id: 'n3', title: '来源原版' }],
        unresolvedIds: ['old-missing'],
      });
    } });
    await screen.findByRole('link', { name: '《合并结果》' });
    fireEvent.click(screen.getByText('导入的原文 / 校对 / 润色'));
    fireEvent.click(screen.getByRole('tab', { name: '校对' }));
    expect(screen.getByLabelText('导入版本正文').textContent).toContain('对字');
    expect(screen.getByText(/比原文改了/)).toBeTruthy();
    fireEvent.click(screen.getByText('合并 1 份原版'));
    expect(screen.getByRole('link', { name: '《来源原版》' }).getAttribute('href')).toBe('#/notes/n3');
    expect(screen.getByText(/关联旧笔记未迁入/)).toBeTruthy();
  });

});
