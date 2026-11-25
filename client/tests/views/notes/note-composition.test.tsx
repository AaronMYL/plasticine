import { act, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyTransaction, noteComposing, trackComposition } from '../../../src/views/notes/note-composition.ts';
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

describe('IME composition gate', () => {
  it('treats start-to-end as composing and ends on blur or non-composing key event', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions() });
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

  it('blocks empty transactions during composition while allowing content, selection, and marked ones', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions(),
      content: '前半句，后半句。', contentType: 'markdown' });
    const seen: boolean[] = [];
    editor.on('transaction', ({ transaction }) => seen.push(emptyTransaction(transaction)));
    editor.view.dispatch(editor.state.tr);
    expect(seen).toEqual([true]);
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(noteComposing(editor)).toBe(true);
    expect(editor.commands.undoInputRule()).toBe(false);
    editor.view.dispatch(editor.state.tr);
    expect(seen).toEqual([true]);
    editor.view.dispatch(editor.state.tr.insertText('字', 3));
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    expect(seen).toEqual([true, false, false]);
    expect(editor.getText()).toBe('前半字句，后半句。');
    editor.destroy();
  });

  it('typing re-renders do not repeatedly reconfigure editor', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '开头的一句') });
    const editor = await noteEditor();
    const setOptions = vi.spyOn(editor, 'setOptions');
    for (const char of '接着写了十个字不止吧') {
      act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, char); });
    }
    expect(setOptions.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('external version arriving during composition waits until composition ends to swap body', async () => {
    const app = await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '原来的正文') });
    const editor = await noteEditor();
    const dom = editor.view.dom;
    act(() => { dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    const current = await app.api.notes.get('n1');
    const saved = await app.api.notes.save('n1', { markdown: '别处写的新版本', version: current.version,
      requestId: 'remote-1' });
    await act(async () => {
      app.state.notesCache.remember(saved);
      await Promise.resolve();
    });
    expect(editor.getText()).toContain('原来的正文');
    act(() => { dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
    await waitFor(() => expect(editor.getText()).toContain('别处写的新版本'));
  });
});
