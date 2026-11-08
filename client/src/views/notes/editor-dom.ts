// 笔记编辑器的视图 DOM（第 3 批合并后修）：笔记页是开着的标签，切走再切回来时 React 先重连上层组件的 effect，
// tiptap 的视图要等 EditorContent 重新挂上（mount 事件）才有；那之前读 editor.view.dom 会抛「editor view is not
// available」，整个主区落进「这一页出错了」。要在 effect 里挂监听的地方都从这里拿 DOM：没挂上是 null，挂上、卸下
// 时重新渲染，effect 跟着重跑。

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';

/** 挂着的视图的 DOM；没挂上（视图是 tiptap 的占位代理，没有 dom）或已销毁是 null。 */
export function editorDom(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) {
    return null;
  }
  const view = editor.view;
  return 'dom' in view ? view.dom : null;
}

/** 同上，挂上、卸下时更新。 */
export function useEditorDom(editor: Editor | null): HTMLElement | null {
  const [dom, setDom] = useState<HTMLElement | null>(() => (editor === null ? null : editorDom(editor)));
  useEffect(() => {
    if (editor === null) {
      setDom(null);
      return;
    }
    const read = (): void => setDom(editorDom(editor));
    read();
    editor.on('mount', read);
    editor.on('unmount', read);
    editor.on('destroy', read);
    return () => {
      editor.off('mount', read);
      editor.off('unmount', read);
      editor.off('destroy', read);
    };
  }, [editor]);
  return dom;
}
