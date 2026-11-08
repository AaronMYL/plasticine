// 续写和补充各管各的（2026-11-04 用户定）：两个都开时各有计时器、请求和显示位，一个出现不清掉另一个；
// 补充的基准在发出请求时就更新，空结果也不会让它一直排在续写前面；补充看的是光标附近，不是整篇最后一段。

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import type { NoteAssistRequest } from '../../../src/api/shared.ts';
import { NOTE_INTERJECT_PAUSE_MS, NOTE_PREDICT_PAUSE_MS } from '../../../src/views/notes/note-suggestions.tsx';
import { renderApp, seedNote, settle } from '../../helpers.tsx';

/** 一次补充最长要等这么久：停顿 3.5 秒再加上假接口和渲染。 */
const INTERJECT_WAIT_MS = NOTE_INTERJECT_PAUSE_MS + 1500;
const TEST_TIMEOUT_MS = 20_000;
const PARAGRAPH = '我正在把一段经历记下来，想分清实际发生的事和自己的解释。'.repeat(4);

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (node?.editor === undefined) { throw new Error('编辑器尚未就绪'); }
    return node.editor;
  });
}

function ghost(): Element | null {
  return document.querySelector('.note-body .note-ghost');
}

function interjection(): Element | null {
  return document.querySelector('.note-body .note-suggestion');
}

function turnOnInterject(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: '补充建议' }));
}

function turnOff(): void {
  for (const name of ['续写建议', '补充建议']) {
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name });
    if (box.checked) { fireEvent.click(box); }
  }
}

describe('续写和补充都开', () => {
  it('停 0.7 秒出续写，再停到 3.5 秒补充也出现，两者同时在；Tab 采用续写，打字清掉两者', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => (
      input.action === 'predict' ? { markdown: '，续写的一句。', label: '续写' }
        : { markdown: '要不要补一条证据？', label: 'Plasticine 想接一句' }));
    turnOnInterject();
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: NOTE_PREDICT_PAUSE_MS + 1500 });
    expect(interjection()).toBeNull();
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()?.textContent).toBe('，续写的一句。');
    expect(interjection()?.textContent).toContain('要不要补一条证据？');
    expect(assist.mock.calls.map((call) => call[1].action)).toEqual(['predict', 'interject']);
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getText()).toContain(`${PARAGRAPH}，续写的一句。`);
    expect(editor.getText()).not.toContain('要不要补一条证据');
    expect(ghost()).toBeNull();
    expect(interjection()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('续写回来得比补充晚也不清掉补充；「加上」只采用补充，Esc 两个一起收起', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const slow = Promise.withResolvers<void>();
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => {
      if (input.action === 'interject') { return { markdown: '补一句。', label: 'Plasticine 想接一句' }; }
      await slow.promise;
      return { markdown: '，续写。', label: '续写' };
    });
    turnOnInterject();
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()).toBeNull();
    await act(async () => slow.resolve());
    await waitFor(() => expect(ghost()).not.toBeNull());
    expect(interjection()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加上' }));
    expect(editor.getText()).toContain('补一句。');
    expect(editor.getText()).not.toContain('，续写。');
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(interjection()).not.toBeNull(), { timeout: INTERJECT_WAIT_MS });
    expect(ghost()).not.toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    expect(ghost()).toBeNull();
    expect(interjection()).toBeNull();
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('补充输出空后续写照常出现，补充的基准在发出时就更新，不会马上再要一次', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头') });
    const editor = await noteEditor();
    const assist = vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => (
      input.action === 'predict' ? { markdown: '，续写。', label: '续写' } : { markdown: '', label: 'Plasticine 想接一句' }));
    turnOnInterject();
    act(() => { editor.commands.focus('end'); editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(assist.mock.calls.some((call) => call[1].action === 'interject')).toBe(true),
      { timeout: INTERJECT_WAIT_MS });
    await settle();
    expect(interjection()).toBeNull();
    act(() => { editor.commands.insertContent(PARAGRAPH); });
    await waitFor(() => expect(ghost()).not.toBeNull(), { timeout: NOTE_PREDICT_PAUSE_MS + 1500 });
    await settle(NOTE_INTERJECT_PAUSE_MS + 300);
    expect(assist.mock.calls.map((call) => call[1].action)).toEqual(['predict', 'interject', 'predict']);
    turnOff();
  }, TEST_TIMEOUT_MS);

  it('长笔记中间位置的补充，送去的是光标前后的内容，不是整篇最后一段', async () => {
    const head = `# 开头\n\n${'很早以前写下的背景。'.repeat(700)}`;
    const middle = '光标所在的这一段，正在想下一步怎么验证。';
    const tail = `${'后面早就写好的结论。'.repeat(700)}\n\n全文最后一句。`;
    const app = await renderApp({ hash: '#/notes/n1',
      setup: (fake) => seedNote(fake, 'n1', `${head}\n\n${middle}\n\n${tail}`) });
    const editor = await noteEditor();
    const requests: NoteAssistRequest[] = [];
    vi.spyOn(app.api.notes, 'assist').mockImplementation(async (_id, input) => {
      requests.push(input);
      return { markdown: '', label: '建议' };
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '续写建议' }));
    turnOnInterject();
    let end = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.textContent === middle) { end = offset + node.nodeSize - 1; }
    });
    expect(end).toBeGreaterThan(0);
    act(() => { editor.chain().focus().setTextSelection(end).insertContent(PARAGRAPH).run(); });
    await waitFor(() => expect(requests.length).toBe(1), { timeout: INTERJECT_WAIT_MS });
    const [request] = requests;
    expect(request?.action).toBe('interject');
    expect(request?.before?.endsWith(`${middle}${PARAGRAPH}`)).toBe(true);
    expect(request?.after).toContain('后面早就写好的结论');
    expect(request?.after).not.toContain(middle);
    expect(request?.before).not.toContain('全文最后一句');
    expect(request?.markdown).toBe(request?.before);
    turnOff();
  }, TEST_TIMEOUT_MS);
});
