import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { expect, it, vi } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';

async function open() {
  const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1',
    '先记下事情经过。\n\n最后写下自己的想法。') });
  const editor = await waitFor(() => {
    const dom = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (dom?.editor === undefined) throw new Error('编辑器未就绪');
    return dom.editor;
  });
  return { ...app, editor };
}

it('选段可主动要一组补充；加上先就地预览草稿，留下才进正文，撤销不改正文', async () => {
  const { api, editor } = await open();
  const original = editor.getMarkdown();
  const assist = vi.spyOn(api.notes, 'assist').mockResolvedValue({ markdown: '', label: '补充建议', suggestions: [
    { kind: 'supplement', text: '补上待确认的日期', draft: '日期：[待确认]。' },
    { kind: 'example', text: '补一个已有的例子', draft: '例如，之前写过的那次练习。' },
  ] });
  act(() => editor.chain().focus().setTextSelection({ from: 1, to: 9 }).run());
  const toolbar = await screen.findByRole('toolbar', { name: '选中文字操作' });
  fireEvent.click(within(toolbar).getByRole('button', { name: '补充建议' }));
  const group = await screen.findByRole('group', { name: '补充建议' });
  expect(assist.mock.calls[0]?.[1]).toMatchObject({ action: 'interject', selected: '先记下事情经过。' });
  fireEvent.click(within(group).getAllByRole('button', { name: '加上' })[0]!);
  expect(editor.getMarkdown()).toBe(original);
  const draft = screen.getByRole('group', { name: '补充草稿' });
  expect(draft.textContent).toContain('日期：[待确认]。');
  fireEvent.click(within(draft).getByRole('button', { name: '撤销' }));
  expect(editor.getMarkdown()).toBe(original);
  fireEvent.click(within(group).getAllByRole('button', { name: '加上' })[1]!);
  fireEvent.click(screen.getByRole('button', { name: '留下' }));
  expect(editor.getMarkdown()).toContain('例如，之前写过的那次练习。\n\n最后写下自己的想法。');
  expect(editor.getMarkdown()).not.toContain('日期：[待确认]。');
});

it('结构建议沿用修改稿对比，采用之前不改正文；工具条两个选项使用开关', async () => {
  const { api, editor } = await open();
  expect(screen.getByRole('switch', { name: '续写' })).toBeTruthy();
  expect(screen.getByRole('switch', { name: '补充建议' })).toBeTruthy();
  vi.spyOn(api.notes, 'assist').mockResolvedValue({ markdown: '', label: '补充建议', suggestions: [
    { kind: 'structure', text: '给经过加一个小标题', draft: '## 事情经过\n\n先记下事情经过。' },
  ] });
  act(() => editor.chain().focus().setTextSelection({ from: 1, to: 9 }).run());
  fireEvent.click(within(await screen.findByRole('toolbar', { name: '选中文字操作' }))
    .getByRole('button', { name: '补充建议' }));
  fireEvent.click(await screen.findByRole('button', { name: '加上' }));
  const review = await screen.findByRole('region', { name: '笔记改动对照' });
  expect(editor.getMarkdown()).not.toContain('##');
  fireEvent.click(within(review).getByRole('button', { name: '采用所选' }));
  expect(editor.getMarkdown()).toContain('## 事情经过');
  expect(editor.getMarkdown()).toContain('最后写下自己的想法。');
});
