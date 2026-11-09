import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, seedNote, settle } from '../../helpers.tsx';

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (node?.editor === undefined) { throw new Error('编辑器尚未就绪'); }
    return node.editor;
  });
}

describe('笔记 AI 编辑流程', () => {
  it('自定义修改可作用整篇，先编辑修改稿再采用，并保留后来新增的段落', async () => {
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', '# 标题\n\n原段\n\n结尾') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist').mockResolvedValue({
      markdown: '# 标题\n\n新段\n\n结尾', label: '按要求修改',
    });
    fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '按要求修改全文' }));
    fireEvent.change(screen.getByRole('textbox', { name: '修改要求' }), { target: { value: '写得自然些' } });
    fireEvent.click(screen.getByRole('button', { name: '生成修改稿' }));
    const review = await screen.findByRole('region', { name: '笔记改动对照' });
    expect(assist.mock.calls[0]?.[1]).toMatchObject({ action: 'custom', instruction: '写得自然些' });
    expect(editor.getText()).toContain('原段');
    fireEvent.click(within(review).getByRole('tab', { name: '编辑修改稿' }));
    const draft = within(review).getByRole('textbox', { name: '修改稿' });
    fireEvent.change(draft, { target: { value: '# 标题\n\n自己再调整的新段\n\n结尾' } });
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size, '<p>后来新增</p>'));
    fireEvent.click(within(review).getByRole('tab', { name: /逐处比较/ }));
    fireEvent.click(within(review).getByRole('button', { name: '采用所选' }));
    expect(editor.getText()).toContain('自己再调整的新段');
    expect(editor.getText()).toContain('后来新增');
    expect(screen.queryByRole('region', { name: '笔记改动对照' })).toBeNull();
  });

  it('选段自定义修改保留焦点移到输入框前的范围，只替换目标文字', async () => {
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', '前文背景。\n\n原来的句子。\n\n后文结论。') });
    const editor = await noteEditor();
    const from = editor.state.doc.child(0).nodeSize + 1;
    const to = from + '原来的句子。'.length;
    const assist = vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '调整后的句子。', label: '润色' });
    act(() => editor.chain().focus().setTextSelection({ from, to }).run());
    const selection = await screen.findByRole('toolbar', { name: '选中文字操作' });
    fireEvent.click(within(selection).getByRole('button', { name: '按要求修改选段' }));
    const prompt = screen.getByRole('textbox', { name: '修改要求' });
    fireEvent.focus(prompt);
    fireEvent.change(prompt, { target: { value: '结合前文，把这句说清楚' } });
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    const review = await screen.findByRole('region', { name: '笔记改动对照' });
    expect(assist.mock.calls[0]?.[1]).toMatchObject({
      action: 'custom', selected: '原来的句子。', instruction: '结合前文，把这句说清楚',
    });
    expect(assist.mock.calls[0]?.[1].before).toContain('前文背景');
    expect(assist.mock.calls[0]?.[1].after).toContain('后文结论');
    fireEvent.click(within(review).getByRole('button', { name: '采用所选' }));
    expect(editor.getMarkdown()).toBe('前文背景。\n\n调整后的句子。\n\n后文结论。');
  });

  it('尚未处理的修改稿不会被下一次请求覆盖，重叠输入仍要求重新比较', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '原文') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '建议', label: '润色' });
    fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '整篇润色' }));
    const review = await screen.findByRole('region', { name: '笔记改动对照' });
    fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
    expect(screen.getByRole('menuitem', { name: '整篇润色' }).hasAttribute('disabled')).toBe(true);
    expect(assist).toHaveBeenCalledTimes(1);
    act(() => editor.commands.setContent('我又改了原文', { contentType: 'markdown' }));
    fireEvent.click(within(review).getByRole('button', { name: '采用所选' }));
    await within(review).findByRole('alert');
    expect(editor.getText()).toBe('我又改了原文');
  });

  it('引用选段在手机打开就地对话，并保留已有对话草稿', async () => {
    const app = await renderApp({ hash: '#/notes/n1', width: 390,
      setup: (fake) => seedNote(fake, 'n1', '正文里的选段') });
    const editor = await noteEditor();
    app.state.conversationUi.setDraft('还没发出的问题');
    act(() => editor.commands.setTextSelection({ from: 1, to: 5 }));
    const selection = await screen.findByRole('toolbar', { name: '选中文字操作' });
    fireEvent.click(within(selection).getByRole('button', { name: '引用到对话' }));
    await waitFor(() => expect(app.state.shellPrefs.store.get().phoneChatOpen).toBe(true));
    expect(app.state.conversationUi.store.get().quotes[0]?.text).toBe('正文里的');
    expect(app.state.conversationUi.store.get().draft).toBe('还没发出的问题');
    expect(screen.queryByRole('toolbar', { name: '选中文字操作' })).toBeNull();
  });

  it('预测失败不会重试之前的手动改写，下次预测成功会清掉自己的错误', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在写下的一段原文') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist')
      .mockResolvedValueOnce({ markdown: '改写的一段', label: '润色' })
      .mockRejectedValueOnce(new Error('续写暂时连接失败'))
      .mockResolvedValue({ markdown: '，新的候选。', label: '续写' });
    fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '整篇润色' }));
    await screen.findByRole('region', { name: '笔记改动对照' });
    fireEvent.click(screen.getByRole('button', { name: '保留当前正文' }));
    act(() => editor.commands.focus('end'));
    await screen.findByText(/续写暂时连接失败/, {}, { timeout: 3000 });
    expect(screen.queryByRole('button', { name: '重试生成' })).toBeNull();
    act(() => editor.commands.insertContent('继续'));
    await waitFor(() => expect(document.querySelector('.note-ghost')).not.toBeNull(), { timeout: 3000 });
    expect(screen.queryByText(/续写暂时连接失败/)).toBeNull();
    expect(assist.mock.calls.map((call) => call[1].action)).toEqual(['polish', 'predict', 'predict']);
  });
});

describe('笔记续写输入保护', () => {
  // 2026-11-09 改：组字开始不再撤在途的续写（组完提交的字可能正是灰字的开头），组字期间不画、不采用。
  it('中文组字开始不撤在途的续写；组字期间到的结果不画、Tab 不采用；组完正文没变再画出来', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在写作的文字') });
    const editor = await noteEditor();
    const gate = Promise.withResolvers<{ markdown: string; label: string }>();
    let signal: AbortSignal | undefined;
    vi.spyOn(app.api.notes, 'assist').mockImplementation((_id, _input, nextSignal) => {
      signal = nextSignal;
      return gate.promise;
    });
    act(() => editor.commands.focus('end'));
    await waitFor(() => expect(signal).toBeDefined(), { timeout: 3000 });
    fireEvent.compositionStart(editor.view.dom);
    expect(signal?.aborted).toBe(false);
    await act(async () => gate.resolve({ markdown: '，组完再出现的候选', label: '续写' }));
    expect(document.querySelector('.note-ghost')).toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: 'Tab', isComposing: true });
    expect(editor.getText()).toBe('正在写作的文字');
    fireEvent.compositionEnd(editor.view.dom);
    await waitFor(() => expect(document.querySelector('.note-ghost')?.textContent).toBe('，组完再出现的候选'));
    expect(editor.getText()).toBe('正在写作的文字');
    fireEvent.click(screen.getByRole('checkbox', { name: '续写建议' }));
  });

  it('候选不进入可编辑正文，移动光标后旧候选不能写到原位置', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在写作的文字') });
    const editor = await noteEditor();
    act(() => editor.commands.focus('end'));
    await waitFor(() => expect(document.querySelector('.note-ghost')).not.toBeNull(), { timeout: 3000 });
    expect(editor.view.dom.querySelector('.note-ghost')).toBeNull();
    act(() => editor.commands.setTextSelection(1));
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getText()).toBe('正在写作的文字');
    fireEvent.click(screen.getByRole('checkbox', { name: '续写建议' }));
    await settle();
  });
});

function countNodes(editor: Editor, name: string): number {
  let count = 0;
  editor.state.doc.descendants((node) => { if (node.type.name === name) { count += 1; } });
  return count;
}

describe('笔记建议贴着正文', () => {
  it('编号列表里按 Tab 先采用续写，不把这一项缩进成下一级', async () => {
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', '1. 第一项要点\n2. 正在写的第二项') });
    const editor = await noteEditor();
    vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '，接着写完。', label: '续写' });
    act(() => editor.commands.focus('end'));
    await waitFor(() => expect(document.querySelector('.note-ghost')).not.toBeNull(), { timeout: 3000 });
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getText()).toContain('正在写的第二项，接着写完。');
    expect(countNodes(editor, 'orderedList')).toBe(1);
    expect(countNodes(editor, 'listItem')).toBe(2);
    fireEvent.click(screen.getByRole('checkbox', { name: '续写建议' }));
  });

  it('续写灰字只在光标处，顶部工具栏没有建议条；点灰字也能采用', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '正在写作的文字') });
    const editor = await noteEditor();
    vi.spyOn(app.api.notes, 'assist').mockResolvedValue({ markdown: '，点一下就采用。', label: '续写' });
    act(() => editor.commands.focus('end'));
    await waitFor(() => expect(document.querySelector('.note-body .note-ghost')).not.toBeNull(), { timeout: 3000 });
    expect(document.querySelector('.note-command-bar .note-suggestion')).toBeNull();
    expect(document.querySelector('.note-command-bar .note-ghost')).toBeNull();
    expect(document.querySelector('.note-command-bar kbd')).toBeNull();
    fireEvent.click(document.querySelector('.note-ghost')!);
    expect(editor.getText()).toBe('正在写作的文字，点一下就采用。');
    fireEvent.click(screen.getByRole('checkbox', { name: '续写建议' }));
  });
});
