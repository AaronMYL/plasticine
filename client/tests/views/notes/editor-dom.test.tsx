// 编辑器视图没挂上时不碰 view.dom（第 3 批合并后修）：笔记页是开着的标签，切走再切回来时 React 先重连上层的
// effect，tiptap 的视图要等 EditorContent 重新挂上才有；那之前读 view.dom 会抛错，整个主区落进「这一页出错了」。

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

describe('笔记编辑器的视图 DOM', () => {
  it('没挂上时是 null，不抛错；挂上、卸下、再挂上都跟着变', () => {
    // element: null 时 tiptap 不自己挂（像 EditorContent 还没挂上的那一刻）。
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

  it('没有编辑器、编辑器已经销毁都是 null', () => {
    const { result } = renderHook(() => useEditorDom(null));
    expect(result.current).toBeNull();
    editor = new Editor({ extensions: [StarterKit], content: '<p>正文</p>' });
    editor.destroy();
    expect(editorDom(editor)).toBeNull();
  });
});
