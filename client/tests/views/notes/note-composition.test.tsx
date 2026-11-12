// 输入法组字的闸门（11-12 全量优化第 12 条）：组字期间不换正文、不动装饰；编辑器配置不随每次渲染重设。

import { act, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteComposing, trackComposition } from '../../../src/views/notes/note-composition.ts';
import { noteExtensions } from '../../../src/views/notes/editor-extensions.ts';
import { renderApp, seedNote } from '../../helpers.tsx';

async function noteEditor(): Promise<Editor> {
  return waitFor(() => {
    const node = document.querySelector<HTMLElement & { editor?: Editor }>('.note-body .ProseMirror');
    if (node?.editor === undefined) { throw new Error('编辑器尚未就绪'); }
    return node.editor;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('组字闸门', () => {
  it('开始组字到结束之间算在组字；失焦、来了一个不带组字标记的按键也算结束', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions() });
    // 事件发在另一个元素上：ProseMirror 自己的 composing 不跟着变，这里只看闸门自己记的那一份。
    const dom = document.createElement('div');
    const stop = trackComposition(editor, dom);
    expect(noteComposing(editor)).toBe(false);
    dom.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(noteComposing(editor)).toBe(true);
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, isComposing: true }));
    expect(noteComposing(editor)).toBe(true);
    dom.dispatchEvent(new CompositionEvent('compositionend'));
    expect(noteComposing(editor)).toBe(false);
    dom.dispatchEvent(new CompositionEvent('compositionstart'));
    dom.dispatchEvent(new FocusEvent('blur'));
    expect(noteComposing(editor)).toBe(false);
    dom.dispatchEvent(new CompositionEvent('compositionstart'));
    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(noteComposing(editor)).toBe(false);
    dom.dispatchEvent(new CompositionEvent('compositionstart'));
    stop();
    expect(noteComposing(editor)).toBe(false);
    editor.destroy();
    expect(noteComposing(editor)).toBe(false);
  });

  it('打字引起的重新渲染不再反复重设编辑器配置', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头的一句') });
    const editor = await noteEditor();
    const setOptions = vi.spyOn(editor, 'setOptions');
    for (const char of '接着写了十个字不止吧') {
      act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, char); });
    }
    // 建好后的头一次渲染 TipTap 会把解析过的正文和原文对一次，之后配置稳定，不再调。
    expect(setOptions.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('组字期间别处来的新版本不换正文，组完才换', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '原来的正文') });
    const editor = await noteEditor();
    const dom = editor.view.dom;
    act(() => { dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    const current = await app.api.notes.get('n1');
    const saved = await app.api.notes.save('n1', { markdown: '别处写的新版本', version: current.version,
      requestId: 'remote-1' });
    await act(async () => { app.state.notesCache.remember(saved); await Promise.resolve(); });
    expect(editor.getText()).toContain('原来的正文');
    act(() => { dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    await waitFor(() => expect(editor.getText()).toContain('别处写的新版本'));
  });
});
