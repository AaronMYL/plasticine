import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { NOTE_ASSIST_CONTEXT_CHARS, NOTE_PREDICT_BEFORE_CHARS, NOTE_PREDICT_AFTER_CHARS,
  type NoteAssistRequest, type NoteSupplement } from '../../api/shared.ts';
import { useEditorDom } from './editor-dom.ts';
import { noteComposing } from './note-composition.ts';
import { InlineSuggestion, type Suggestion } from './note-inline-suggestion.tsx';
import { LoopReports } from './note-loop-reports.ts';
import { imeBusy, PREDICT_PAUSE_MS } from '../compose/predict-rules.ts';
import { followTyping, ghostPosition, remaining, startPrediction, withDelta, withFinal,
  type LivePrediction } from './note-predict-live.ts';
import { flushSuggestionSpace, SUGGESTION_KINDS, suggestionSpacePlugin, unregisterSuggestionSpace,
  type SuggestionKind } from './note-suggestion-space.ts';

export const NOTE_PREDICT_PAUSE_MS = PREDICT_PAUSE_MS;
export const NOTE_INTERJECT_PAUSE_MS = 3000;
const COMPOSITION_SETTLE_MS = 30;
const SUGGEST_MIN_CHARS = 6;
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
  const where = useRef({ api, noteId });
  where.current = { api, noteId };
  const reports = useRef<LoopReports | null>(null);
  reports.current ??= new LoopReports((outcome) => {
    void where.current.api.notes.assistOutcome(where.current.noteId, outcome)
      .catch((cause: unknown) => console.warn('笔记建议的结果没报上，这一条不算', cause));
  });
  const predictLoopId = useRef<string | undefined>(undefined);
  const given = useRef({ noteId, paragraphs: new GivenParagraphs() });
  if (given.current.noteId !== noteId) {
    given.current = { noteId, paragraphs: new GivenParagraphs() };
  }
  const show = (kind: SuggestionKind, value: Suggestion | null): void => {
    if (sameSuggestion(shownRef.current[kind], value)) { return; }
    shownRef.current = { ...shownRef.current, [kind]: value };
    setShown(shownRef.current);
  };
  const showPrediction = (): void => {
    if (composing.current || noteComposing(editor)) { return; }
    const value = live.current;
    const text = value === null ? '' : remaining(value);
    show('predict', value === null || text === '' ? null
      : { kind: 'predict', text, position: ghostPosition(value), doc: value.doc });
  };
  const drop = (kind: SuggestionKind): void => {
    reports.current?.dropped(kind);
    if (kind === 'predict') {
      predictLoopId.current = undefined;
      requests.current.predict?.abort();
      requests.current.predict = null;
      live.current = null;
    } else {
      const pending = requests.current.interject;
      if (pending !== null) {
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
    && !composing.current && !noteComposing(editor) && editor.state.doc === value.doc
    && (value.range === undefined ? editor.state.selection.empty && editor.state.selection.from === value.position
      : editor.state.selection.from === value.range.from && editor.state.selection.to === value.range.to);
  const adopt = (kind: SuggestionKind, item?: NoteSupplement): void => {
    const value = shownRef.current[kind];
    if (value === null || !current(value)) {
      drop(kind);
      return;
    }
    if (kind === 'interject' && item === undefined) return;
    reports.current?.kept(kind, kind === 'predict' ? predictLoopId.current : item?.loopId);
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
      given.current.paragraphs.add(editor.state.selection.$from.parent.textContent);
    }
  };
  const handlers = useRef({ dropAll, adopt });
  handlers.current = { dropAll, adopt };

  useEffect(() => {
    editor.registerPlugin(suggestionSpacePlugin((_view, event) => {
      const visible = shownRef.current;
      if (imeBusy(event, composing.current || noteComposing(editor))
        || (visible.predict === null && visible.interject === null)) {
        return false;
      }
      if (event.key === 'Tab' && visible.predict !== null) {
        event.preventDefault();
        handlers.current.adopt('predict');
        return true;
      }
      if (event.key === 'Escape') {
        for (const kind of SUGGESTION_KINDS) reports.current?.rejected(kind);
        handlers.current.dropAll();
        return true;
      }
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
      if (candidate.items!.length > 0 && current(candidate)) {
        show('interject', candidate);
        reports.current?.shown('interject', candidate.items!.map((item) => item.loopId));
      }
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
        if (timer !== null) {
          clearTimeout(timer);
          timers[kind] = null;
        }
      }
    };
    const eligible = (): boolean => !disposed && !paused && !editor.isDestroyed && editor.isEditable
      && editor.isFocused && !composing.current && !noteComposing(editor) && editor.state.selection.empty
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
        if (final === null || remaining(final) === '') {
          drop('predict');
          return;
        }
        live.current = final;
        predictLoopId.current = view.loopId;
        showPrediction();
        if (shownRef.current.predict !== null) { reports.current?.shown('predict', [view.loopId]); }
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
          reports.current?.shown('interject', (candidate.items ?? []).map((item) => item.loopId));
        } else {
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
    const sync = (): void => {
      if (disposed || composing.current || noteComposing(editor)) { return; }
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
      body?.setAttribute('data-composing', '');
    };
    const endComposition = (): void => {
      const finish = (): void => {
        if (disposed || editor.isDestroyed) { return; }
        if (noteComposing(editor)) {
          settled = setTimeout(finish, COMPOSITION_SETTLE_MS);
          return;
        }
        settled = null;
        composing.current = false;
        flushSuggestionSpace(editor);
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
  }, [api, editor, dom, noteId, predict, interject, paused]);

  return SUGGESTION_KINDS.map((kind) => {
    const value = shown[kind];
    return value === null ? null : <InlineSuggestion key={kind} editor={editor} suggestion={value}
      onAdopt={(item) => adopt(kind, item)} onDismiss={() => drop(kind)} />;
  });
}
