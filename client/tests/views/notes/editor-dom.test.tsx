import { act, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { editorDom, useEditorDom } from '../../../src/views/notes/editor-dom.ts';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('Note editor view DOM', () => {
  it('returns null without throwing when unmounted and tracks mount, unmount, and remount', () => {
    editor = new Editor({ element: null, extensions: [StarterKit], content: '<p>正文</p>' });
    const current = editor;
    expect(editorDom(current)).toBeNull();
    const { result } = renderHook(() => useEditorDom(current));
    expect(result.current).toBeNull();
    const host = document.createElement('div');
    document.body.append(host);
    act(() => current.mount(host));
    expect(result.current).toBe(current.view.dom);
    act(() => current.unmount());
    expect(result.current).toBeNull();
    act(() => current.mount(host));
    expect(result.current).toBe(current.view.dom);
    host.remove();
  });

  it('returns null when editor is missing or already destroyed', () => {
    const { result } = renderHook(() => useEditorDom(null));
    expect(result.current).toBeNull();
    editor = new Editor({ extensions: [StarterKit], content: '<p>正文</p>' });
    editor.destroy();
    expect(editorDom(editor)).toBeNull();
  });
});
