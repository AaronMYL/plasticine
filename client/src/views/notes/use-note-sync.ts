// 共享缓存把新版本带到当前编辑器；NoteSaver 决定能否替换，未保存草稿不被后台读覆盖。
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import type { NoteView } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useEditorDom } from './editor-dom.ts';
import type { NoteSaver } from './note-saver.ts';

/** 等待 ProseMirror 提交组合输入的原生 DOM 更新，再尝试接入已确认的新版本。 */
const COMPOSITION_SETTLE_MS = 30;

export function useNoteSync(note: NoteView, saver: NoteSaver, editor: Editor | null): {
  syncError: string | null; retrySync: () => void; aiChanged: boolean;
} {
  const api = useApi();
  const { notesCache } = useClientState();
  const cached = useStore(notesCache.store).get(note.id);
  const saveStatus = useStore(saver.state).status;
  const fresh = cached?.note ?? note;
  const [aiChanged, setAiChanged] = useState(false);
  const retrySync = useCallback(() => { void notesCache.loadNote(api.notes, note.id, true); },
    [api, notesCache, note.id]);
  const dom = useEditorDom(editor);
  useEffect(() => {
    if (editor === null || dom === null) { return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = (): void => {
      if (editor.isDestroyed || editor.view.composing) { return; }
      const newerAi = fresh.author === 'ai' && fresh.version > saver.current().version;
      if (saver.applyRemote(fresh)) {
        editor.commands.setContent(fresh.markdown, { contentType: 'markdown', emitUpdate: false });
        setAiChanged(newerAi);
      }
    };
    const afterComposition = (): void => {
      const settle = (): void => {
        if (editor.isDestroyed) { return; }
        if (editor.view.composing) { timer = setTimeout(settle, COMPOSITION_SETTLE_MS); }
        else { apply(); }
      };
      if (timer !== null) { clearTimeout(timer); }
      timer = setTimeout(settle, COMPOSITION_SETTLE_MS);
    };
    const clearCursor = (): void => setAiChanged(false);
    apply();
    editor.on('transaction', apply);
    editor.on('update', clearCursor);
    dom.addEventListener('compositionend', afterComposition);
    return () => {
      if (timer !== null) { clearTimeout(timer); }
      dom.removeEventListener('compositionend', afterComposition);
      editor.off('transaction', apply);
      editor.off('update', clearCursor);
    };
  }, [editor, dom, fresh, saver, saveStatus]);
  return { syncError: cached?.error ?? null, retrySync, aiChanged };
}
