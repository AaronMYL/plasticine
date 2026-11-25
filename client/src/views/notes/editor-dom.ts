import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';

export function editorDom(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) {
    return null;
  }
  const view = editor.view;
  return 'dom' in view ? view.dom : null;
}

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
