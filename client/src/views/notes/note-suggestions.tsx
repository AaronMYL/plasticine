// 笔记里的两种自动建议（2026-11-04 用户定：各管各的、可以同时出现；2026-11-09 他定按第一性原理重做）：
// - 续写：停笔 NOTE_PREDICT_PAUSE_MS，光标后的灰字；边生成边显示，第一段字到了就画。接着打的字和灰字开头一样，
//   灰字留着、只去掉打出的部分（note-predict-live.ts）；对不上才撤下，等下一次停笔。Tab 或点灰字采用。
// - 补充：光标停在段尾约 3 秒给一次，同一段只给一次（段落内容没变就不再给；换段或这段又写了新内容算新的一次），
//   没什么可补就不出。「加上」或点文字采用，× 不用。
// 中文输入法组字期间不改正文也不改装饰：建议只用 CSS 藏起来（.note-body[data-composing]），在途的续写接着收；
// 组完按提交进正文的字比，对得上接着显示剩下的，对不上才撤下。
// 同时在时 Tab 归续写（灰字就在光标后，Tab 是它的键），补充用「加上」或点它的文字；Esc 两个一起收起。

import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { NOTE_ASSIST_CONTEXT_CHARS, NOTE_PREDICT_BEFORE_CHARS, NOTE_PREDICT_AFTER_CHARS,
  type NoteAssistRequest, type NoteSupplement } from '../../api/shared.ts';
import { useEditorDom } from './editor-dom.ts';
import { InlineSuggestion, type Suggestion } from './note-inline-suggestion.tsx';
import { followTyping, ghostPosition, remaining, startPrediction, withDelta, withFinal,
  type LivePrediction } from './note-predict-live.ts';
import { flushSuggestionSpace, SUGGESTION_KINDS, suggestionSpacePlugin, unregisterSuggestionSpace,
  type SuggestionKind } from './note-suggestion-space.ts';

/**
 * 停下就有（2026-11-09）：0.4 秒。拼音打字时候选、空格之间的间隔大多在这以内，再短会在每个词之间都发一次；
 * 灰字边生成边画、照着打不作废，等到的主要是模型出第一个字的时间。
 */
export const NOTE_PREDICT_PAUSE_MS = 400;
/** 补充：光标停在段尾约 3 秒（2026-11-09 他定）。 */
export const NOTE_INTERJECT_PAUSE_MS = 3000;
const COMPOSITION_SETTLE_MS = 30;
/** 这一段写了这么多字才给建议，刚起头的一两个字不值得要。 */
const SUGGEST_MIN_CHARS = 6;
/** 给过补充的段落记这么多就够了，再多丢掉最早的。 */
const INTERJECTED_MAX = 500;

type Shown = Readonly<Record<SuggestionKind, Suggestion | null>>;
const NOTHING_SHOWN: Shown = { predict: null, interject: null };

interface InterjectRequest { controller: AbortController; doc: DocumentNode; position: number; key: string }

function predictRequest(doc: DocumentNode, position: number): NoteAssistRequest {
  const before = doc.textBetween(Math.max(0, position - NOTE_PREDICT_BEFORE_CHARS), position, '\n');
  return {
    action: 'predict',
    markdown: before,
    before,
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

function sameSuggestion(a: Suggestion | null, b: Suggestion | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.text === b.text
    && a.position === b.position && a.doc === b.doc);
}

/** 给过补充的段落：按段落内容记，内容变了就是新的一段。 */
class GivenParagraphs {
  readonly #keys = new Set<string>();

  has(key: string): boolean {
    return this.#keys.has(key);
  }

  add(key: string): void {
    this.#keys.delete(key);
    this.#keys.add(key);
    const oldest = this.#keys.values().next();
    if (this.#keys.size > INTERJECTED_MAX && oldest.done !== true) {
      this.#keys.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.#keys.delete(key);
  }
}

export interface ManualSupplement { seq: number; from: number; to: number }

export function NoteSuggestions({ editor, noteId, predict, interject, paused, onError, manual, onStructure }: {
  editor: Editor; noteId: string; predict: boolean; interject: boolean; paused: boolean;
  onError: (message: string | null) => void;
  manual?: ManualSupplement | null;
  onStructure?: (text: string, range: { from: number; to: number }) => void;
}): ReactNode {
  const api = useApi();
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const shownRef = useRef<Shown>(NOTHING_SHOWN);
  const composing = useRef(false);
  const latest = useRef({ onError, onStructure });
  latest.current = { onError, onStructure };
  const live = useRef<LivePrediction | null>(null);
  const requests = useRef<{ predict: AbortController | null; interject: InterjectRequest | null }>(
    { predict: null, interject: null });
  const given = useRef({ noteId, paragraphs: new GivenParagraphs() });
  if (given.current.noteId !== noteId) {
    given.current = { noteId, paragraphs: new GivenParagraphs() };
  }
  const show = (kind: SuggestionKind, value: Suggestion | null): void => {
    if (sameSuggestion(shownRef.current[kind], value)) { return; }
    shownRef.current = { ...shownRef.current, [kind]: value };
    setShown(shownRef.current);
  };
  /** 续写的灰字照 live 画；组字期间不碰（React 一重画就可能改装饰），组完再画。 */
  const showPrediction = (): void => {
    if (composing.current || editor.view.composing) { return; }
    const value = live.current;
    const text = value === null ? '' : remaining(value);
    show('predict', value === null || text === '' ? null
      : { kind: 'predict', text, position: ghostPosition(value), doc: value.doc });
  };
  const drop = (kind: SuggestionKind): void => {
    if (kind === 'predict') {
      requests.current.predict?.abort();
      requests.current.predict = null;
      live.current = null;
    } else {
      const pending = requests.current.interject;
      if (pending !== null) {
        // 还没回来就被打断的不算给过：回到这一段、内容没变，还可以再要。
        pending.controller.abort();
        given.current.paragraphs.delete(pending.key);
        requests.current.interject = null;
      }
    }
    show(kind, null);
  };
  const dropAll = (): void => {
    for (const kind of SUGGESTION_KINDS) { drop(kind); }
  };
  const current = (value: Suggestion): boolean => !editor.isDestroyed && editor.isEditable
    && !composing.current && !editor.view.composing && editor.state.doc === value.doc
    && (value.range === undefined ? editor.state.selection.empty && editor.state.selection.from === value.position
      : editor.state.selection.from === value.range.from && editor.state.selection.to === value.range.to);
  const adopt = (kind: SuggestionKind, item?: NoteSupplement): void => {
    const value = shownRef.current[kind];
    if (value === null || !current(value)) { drop(kind); return; }
    if (kind === 'interject' && item === undefined) return;
    // 采用会改正文，另一条的位置随之作废，两条一起撤下。
    dropAll();
    if (value.kind === 'predict') {
      editor.chain().focus().insertContentAt(value.position, { type: 'text', text: value.text }).run();
    } else if (item !== undefined) {
      const at = editor.state.doc.resolve(value.position);
      if (item.kind === 'structure') {
        latest.current.onStructure?.(item.draft, value.range ?? { from: at.start(), to: at.end() });
        return;
      }
      const ref = item.reference;
      const link = ref === undefined ? '' : `\n\n[${ref.label.replace(/[\[\]]/g, '')}]`
        + `(#/${ref.kind === 'note' ? 'notes' : 'messages'}/${encodeURIComponent(ref.id)})`;
      editor.chain().focus().insertContentAt(at.after(), `${item.draft}${link}`, { contentType: 'markdown' }).run();
      // 加上的是 Plasticine 的话，不再对着它补充。
      given.current.paragraphs.add(editor.state.selection.$from.parent.textContent);
    }
  };
  const handlers = useRef({ dropAll, adopt });
  handlers.current = { dropAll, adopt };

  useEffect(() => {
    // 排在所有扩展前面：编号 / 待办列表自己也认 Tab（缩进一级），有建议时 Tab 先给采用（2026-11-03 用户反馈）。
    editor.registerPlugin(suggestionSpacePlugin((_view, event) => {
      const visible = shownRef.current;
      if (event.isComposing || composing.current || editor.view.composing
        || (visible.predict === null && visible.interject === null)) {
        return false;
      }
      if (event.key === 'Tab' && visible.predict !== null) {
        event.preventDefault();
        handlers.current.adopt('predict');
        return true;
      }
      if (event.key === 'Escape') { handlers.current.dropAll(); return true; }
      return false;
    }), (plugin, plugins) => [plugin, ...plugins]);
    return () => unregisterSuggestionSpace(editor);
  }, [editor]);

  useEffect(() => {
    if (manual == null || paused) return undefined;
    dropAll();
    const controller = new AbortController();
    const doc = editor.state.doc;
    const { from, to } = manual;
    const before = doc.textBetween(Math.max(0, from - NOTE_ASSIST_CONTEXT_CHARS), from, '\n');
    const after = doc.textBetween(to, Math.min(doc.content.size, to + NOTE_ASSIST_CONTEXT_CHARS), '\n');
    const selected = doc.textBetween(from, to, '\n');
    void api.notes.assist(noteId, { action: 'interject', markdown: editor.getMarkdown(), selected, before, after },
      controller.signal).then((view) => {
      if (controller.signal.aborted || editor.isDestroyed || editor.state.doc !== doc) return;
      const candidate: Suggestion = { text: '', items: view.suggestions ?? [], kind: 'interject',
        doc, position: to, range: { from, to } };
      if (candidate.items!.length > 0 && current(candidate)) show('interject', candidate);
      latest.current.onError(null);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) latest.current.onError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, editor, noteId, manual?.seq]);

  const dom = useEditorDom(editor);
  useEffect(() => {
    if (dom === null) { return; }
    const body = dom.closest('.note-body');
    const timers: Record<SuggestionKind, ReturnType<typeof setTimeout> | null> = { predict: null, interject: null };
    let settled: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const stopTimers = (): void => {
      for (const kind of SUGGESTION_KINDS) {
        const timer = timers[kind];
        if (timer !== null) { clearTimeout(timer); timers[kind] = null; }
      }
    };
    const eligible = (): boolean => !disposed && !paused && !editor.isDestroyed && editor.isEditable
      && editor.isFocused && !composing.current && !editor.view.composing && editor.state.selection.empty
      && editor.state.selection.$from.parent.isTextblock
      && editor.state.selection.$from.parent.type.name !== 'codeBlock'
      && editor.state.selection.$from.parentOffset === editor.state.selection.$from.parent.content.size;
    const paragraphText = (): string => editor.state.selection.$from.parent.textContent;
    const requestPrediction = async (): Promise<void> => {
      timers.predict = null;
      if (!eligible() || live.current !== null) { return; }
      const controller = new AbortController();
      requests.current.predict = controller;
      const doc = editor.state.doc;
      const position = editor.state.selection.from;
      live.current = startPrediction(position, doc);
      const mine = (): boolean => requests.current.predict === controller && live.current !== null;
      try {
        const view = await api.notes.assistStream(noteId, predictRequest(doc, position), (delta) => {
          if (!mine() || live.current === null) { return; }
          live.current = withDelta(live.current, delta);
          showPrediction();
        }, controller.signal);
        if (!mine() || live.current === null) { return; }
        latest.current.onError(null);
        const final = withFinal(live.current, view.markdown);
        if (final === null || remaining(final) === '') { drop('predict'); return; }
        live.current = final;
        showPrediction();
      } catch (cause) {
        if (mine()) {
          latest.current.onError(errorText(cause));
          drop('predict');
        }
      } finally {
        if (requests.current.predict === controller) { requests.current.predict = null; }
      }
    };
    const requestInterjection = async (): Promise<void> => {
      timers.interject = null;
      const key = paragraphText();
      if (!eligible() || requests.current.interject !== null || shownRef.current.interject !== null
        || key.trim().length < SUGGEST_MIN_CHARS || given.current.paragraphs.has(key)) {
        return;
      }
      // 发出就算这一段给过：没什么可补（空）也不再要；回来之前被打断的在 drop 里取消记号。
      given.current.paragraphs.add(key);
      const pending: InterjectRequest = { controller: new AbortController(), doc: editor.state.doc,
        position: editor.state.selection.from, key };
      requests.current.interject = pending;
      try {
        const value = await api.notes.assist(noteId, interjectRequest(editor, pending.position),
          pending.controller.signal);
        if (requests.current.interject !== pending) { return; }
        requests.current.interject = null;
        latest.current.onError(null);
        const candidate: Suggestion = { text: value.markdown, kind: 'interject', position: pending.position,
          doc: pending.doc, items: value.suggestions ?? [] };
        if (candidate.items?.length === 0) { return; }
        if (current(candidate)) {
          show('interject', candidate);
        } else {
          // 回来时正在组字、或者刚好挪开了：没给出去，这一段还可以再要。
          given.current.paragraphs.delete(key);
        }
      } catch (cause) {
        if (requests.current.interject === pending) {
          requests.current.interject = null;
          latest.current.onError(errorText(cause));
        }
      }
    };
    const schedule = (): void => {
      stopTimers();
      if (!eligible() || paragraphText().trim().length < SUGGEST_MIN_CHARS) { return; }
      if (predict && live.current === null) {
        timers.predict = setTimeout(() => void requestPrediction(), NOTE_PREDICT_PAUSE_MS);
      }
      if (interject && shownRef.current.interject === null && !given.current.paragraphs.has(paragraphText())) {
        timers.interject = setTimeout(() => void requestInterjection(), NOTE_INTERJECT_PAUSE_MS);
      }
    };
    /** 正文或光标变了：续写对得上就接着显示，对不上撤下；补充只认它出现时的那一版正文和光标。 */
    const sync = (): void => {
      if (disposed || composing.current || editor.view.composing) { return; }
      const value = live.current;
      if (value !== null) {
        const next = followTyping(value, editor.state.doc, editor.state.selection);
        if (next === null || (next.done && remaining(next) === '')) {
          drop('predict');
        } else if (next !== value) {
          live.current = next;
        }
        showPrediction();
      }
      const pending = requests.current.interject;
      if (pending !== null && (editor.state.doc !== pending.doc || editor.state.selection.from !== pending.position)) {
        drop('interject');
      }
      const visible = shownRef.current.interject;
      if (visible !== null && !current(visible)) { drop('interject'); }
      schedule();
    };
    const startComposition = (): void => {
      composing.current = true;
      stopTimers();
      // 只用 CSS 藏起来：不改 React 状态、不发事务，正在组的那一段一点不动。
      body?.setAttribute('data-composing', '');
    };
    const endComposition = (): void => {
      const finish = (): void => {
        if (disposed || editor.isDestroyed) { return; }
        if (editor.view.composing) { settled = setTimeout(finish, COMPOSITION_SETTLE_MS); return; }
        settled = null;
        composing.current = false;
        flushSuggestionSpace(editor);
        // 先把灰字换成对得上的剩余部分（或撤下）再去掉隐藏，不让组字前的旧灰字闪一下。
        flushSync(() => {
          sync();
          showPrediction();
        });
        body?.removeAttribute('data-composing');
      };
      if (settled !== null) { clearTimeout(settled); }
      settled = setTimeout(finish, COMPOSITION_SETTLE_MS);
    };
    const blur = (): void => {
      stopTimers();
      handlers.current.dropAll();
    };
    dom.addEventListener('compositionstart', startComposition);
    dom.addEventListener('compositionend', endComposition);
    editor.on('update', sync);
    editor.on('selectionUpdate', sync);
    editor.on('blur', blur);
    editor.on('focus', sync);
    if (predict || interject) { sync(); }
    return () => {
      disposed = true;
      stopTimers();
      handlers.current.dropAll();
      if (settled !== null) { clearTimeout(settled); }
      composing.current = false;
      body?.removeAttribute('data-composing');
      editor.off('update', sync);
      editor.off('selectionUpdate', sync);
      editor.off('blur', blur);
      editor.off('focus', sync);
      dom.removeEventListener('compositionstart', startComposition);
      dom.removeEventListener('compositionend', endComposition);
    };
    // show / drop / current 每次渲染重建，但只读 ref 和 editor；effect 跟着它们重跑反而会打断在途请求。
  }, [api, editor, dom, noteId, predict, interject, paused]);

  return SUGGESTION_KINDS.map((kind) => {
    const value = shown[kind];
    return value === null ? null : <InlineSuggestion key={kind} editor={editor} suggestion={value}
      onAdopt={(item) => adopt(kind, item)} onDismiss={() => drop(kind)} />;
  });
}
