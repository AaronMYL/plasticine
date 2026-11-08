// 笔记里的两种自动建议（2026-11-04 用户定：各管各的、可以同时出现）：
// - 续写：停笔 0.7 秒，光标后的灰字；Tab 或点灰字采用。
// - 补充：停笔 3.5 秒，当前段落下方一句；「加上」或点文字采用，× 不用。
// 两者各有计时器、请求和显示位，一个出现不清掉另一个；打字、移动光标、输入法开始照常把两者都撤下。
// 同时在时 Tab 归续写（灰字就在光标后，Tab 是它的键），补充用「加上」或点它的文字；Esc 两个一起收起。

import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { NOTE_ASSIST_CONTEXT_CHARS, NOTE_PREDICT_BEFORE_CHARS, NOTE_PREDICT_AFTER_CHARS,
  type NoteAssistRequest } from '../../api/shared.ts';
import { useEditorDom } from './editor-dom.ts';
import { InlineSuggestion, type Suggestion } from './note-inline-suggestion.tsx';
import { SUGGESTION_KINDS, suggestionSpacePlugin, unregisterSuggestionSpace,
  type SuggestionKind } from './note-suggestion-space.ts';

export const NOTE_PREDICT_PAUSE_MS = 700;
export const NOTE_INTERJECT_PAUSE_MS = 3500;
/** 补充不追着打断：离上一次至少隔一分钟、全文至少多写了这么多字。 */
const INTERJECT_MIN_CHARS = 80;
const INTERJECT_INTERVAL_MS = 60_000;
const COMPOSITION_SETTLE_MS = 30;
const PREDICT_MIN_CHARS = 6;

type Shown = Readonly<Record<SuggestionKind, Suggestion | null>>;
const NOTHING_SHOWN: Shown = { predict: null, interject: null };

function predictRequest(doc: DocumentNode, position: number): NoteAssistRequest {
  return {
    action: 'predict',
    markdown: doc.textBetween(Math.max(0, position - NOTE_PREDICT_BEFORE_CHARS), position, '\n'),
    after: doc.textBetween(position, Math.min(doc.content.size, position + NOTE_PREDICT_AFTER_CHARS), '\n'),
  };
}

/**
 * 补充看光标前后各一段（长笔记写在中间时，不再只看整篇最后 6000 字）。markdown 也放光标前那段：只认 markdown 的
 * 老服务端取它的末尾，看到的同样是光标前。
 */
function interjectRequest(editor: Editor, position: number): NoteAssistRequest {
  const doc = editor.state.doc;
  const serialize = (from: number, to: number): string =>
    editor.storage.markdown.manager.serialize(doc.cut(from, to).toJSON());
  const end = editor.state.selection.$from.after();
  const before = serialize(0, position).slice(-NOTE_ASSIST_CONTEXT_CHARS);
  const after = serialize(end, doc.content.size).slice(0, NOTE_ASSIST_CONTEXT_CHARS);
  return { action: 'interject', markdown: before, before, after };
}

export function NoteSuggestions({ editor, noteId, predict, interject, paused, onError }: {
  editor: Editor; noteId: string; predict: boolean; interject: boolean; paused: boolean;
  onError: (message: string | null) => void;
}): ReactNode {
  const api = useApi();
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const shownRef = useRef<Shown>(NOTHING_SHOWN);
  const composing = useRef(false);
  const latest = useRef({ onError });
  latest.current = { onError };
  const lastInterjection = useRef({ time: 0, length: editor.getText().length });
  const show = (kind: SuggestionKind, value: Suggestion | null): void => {
    if (shownRef.current[kind] === value) { return; }
    shownRef.current = { ...shownRef.current, [kind]: value };
    setShown(shownRef.current);
  };
  const hideAll = (): void => {
    for (const kind of SUGGESTION_KINDS) { show(kind, null); }
  };
  const current = (value: Suggestion): boolean => !editor.isDestroyed && editor.isEditable
    && !composing.current && !editor.view.composing && editor.state.doc === value.doc
    && editor.state.selection.empty && editor.state.selection.from === value.position;
  const adopt = (kind: SuggestionKind): void => {
    const value = shownRef.current[kind];
    if (value === null || !current(value)) { show(kind, null); return; }
    // 采用会改正文，另一条的位置随之作废，两条一起撤下。
    hideAll();
    if (value.kind === 'predict') {
      editor.chain().focus().insertContentAt(value.position, { type: 'text', text: value.text }).run();
    } else {
      editor.chain().focus().insertContentAt(value.position, value.text, { contentType: 'markdown' }).run();
    }
  };
  const handlers = useRef({ show, hideAll, adopt, current });
  handlers.current = { show, hideAll, adopt, current };

  useEffect(() => {
    // 排在所有扩展前面：编号 / 待办列表自己也认 Tab（缩进一级），有建议时 Tab 先给采用（2026-11-03 用户反馈）。
    editor.registerPlugin(suggestionSpacePlugin((_view, event) => {
      const visible = shownRef.current;
      if (event.isComposing || composing.current || editor.view.composing
        || (visible.predict === null && visible.interject === null)) {
        return false;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        handlers.current.adopt(visible.predict === null ? 'interject' : 'predict');
        return true;
      }
      if (event.key === 'Escape') { handlers.current.hideAll(); return true; }
      return false;
    }), (plugin, plugins) => [plugin, ...plugins]);
    return () => unregisterSuggestionSpace(editor);
  }, [editor]);

  const dom = useEditorDom(editor);
  useEffect(() => {
    if (dom === null) { return; }
    const timers: Record<SuggestionKind, ReturnType<typeof setTimeout> | null> = { predict: null, interject: null };
    const controllers: Record<SuggestionKind, AbortController | null> = { predict: null, interject: null };
    let settled: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const cancel = (): void => {
      for (const kind of SUGGESTION_KINDS) {
        const timer = timers[kind];
        if (timer !== null) { clearTimeout(timer); timers[kind] = null; }
        controllers[kind]?.abort();
        controllers[kind] = null;
      }
      handlers.current.hideAll();
    };
    const eligible = (): boolean => !disposed && !paused && !editor.isDestroyed && editor.isEditable
      && editor.isFocused && !composing.current && !editor.view.composing && editor.state.selection.empty
      && editor.state.selection.$from.parent.isTextblock
      && editor.state.selection.$from.parent.type.name !== 'codeBlock'
      && editor.state.selection.$from.parentOffset === editor.state.selection.$from.parent.content.size;
    const request = async (kind: SuggestionKind): Promise<void> => {
      timers[kind] = null;
      if (!eligible()) { return; }
      const signal = new AbortController();
      controllers[kind] = signal;
      const position = editor.state.selection.from;
      const doc = editor.state.doc;
      const input = kind === 'predict' ? predictRequest(doc, position) : interjectRequest(editor, position);
      if (kind === 'interject') {
        // 发出就算一次：空结果、被打断、失败都不再马上重来（2026-11-04：原来只在显示时更新，空结果后一直排补充）。
        lastInterjection.current = { time: Date.now(), length: editor.getText().length };
      }
      try {
        const value = await api.notes.assist(noteId, input, signal.signal);
        const candidate: Suggestion = { text: value.markdown, kind, position, doc };
        if (signal.signal.aborted || !eligible() || !handlers.current.current(candidate)) { return; }
        latest.current.onError(null);
        if (value.markdown.trim() === '') { return; }
        handlers.current.show(kind, candidate);
      } catch (cause) {
        if (!signal.signal.aborted) { latest.current.onError(errorText(cause)); }
      } finally {
        if (controllers[kind] === signal) { controllers[kind] = null; }
      }
    };
    const canInterject = (): boolean => interject
      && Date.now() - lastInterjection.current.time >= INTERJECT_INTERVAL_MS
      && editor.getText().length - lastInterjection.current.length >= INTERJECT_MIN_CHARS;
    const activity = (): void => {
      cancel();
      if (!eligible()) { return; }
      if (predict && editor.state.selection.$from.parent.textContent.trim().length >= PREDICT_MIN_CHARS) {
        timers.predict = setTimeout(() => void request('predict'), NOTE_PREDICT_PAUSE_MS);
      }
      if (canInterject()) {
        timers.interject = setTimeout(() => void request('interject'), NOTE_INTERJECT_PAUSE_MS);
      }
    };
    const startComposition = (): void => { composing.current = true; cancel(); };
    const endComposition = (): void => {
      const finish = (): void => {
        if (disposed || editor.isDestroyed) { return; }
        if (editor.view.composing) { settled = setTimeout(finish, COMPOSITION_SETTLE_MS); return; }
        composing.current = false;
        activity();
      };
      if (settled !== null) { clearTimeout(settled); }
      settled = setTimeout(finish, COMPOSITION_SETTLE_MS);
    };
    dom.addEventListener('compositionstart', startComposition);
    dom.addEventListener('compositionend', endComposition);
    editor.on('update', activity);
    editor.on('selectionUpdate', activity);
    editor.on('blur', cancel);
    editor.on('focus', activity);
    if (predict || interject) { activity(); }
    return () => {
      disposed = true;
      cancel();
      if (settled !== null) { clearTimeout(settled); }
      editor.off('update', activity);
      editor.off('selectionUpdate', activity);
      editor.off('blur', cancel);
      editor.off('focus', activity);
      dom.removeEventListener('compositionstart', startComposition);
      dom.removeEventListener('compositionend', endComposition);
    };
  }, [api, editor, dom, noteId, predict, interject, paused]);

  return SUGGESTION_KINDS.map((kind) => {
    const value = shown[kind];
    return value === null ? null : <InlineSuggestion key={kind} editor={editor} suggestion={value}
      onAdopt={() => adopt(kind)} onDismiss={() => show(kind, null)} />;
  });
}
