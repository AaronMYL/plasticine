import { createPortal } from 'react-dom';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { NOTE_ASSIST_CONTEXT_CHARS, type NoteAssistRequest } from '../../api/shared.ts';
import { DropdownMenu, SEPARATOR } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { editorDom } from './editor-dom.ts';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { noteExtensions } from './editor-extensions.ts';
import { placeSelectionTools, SELECTION_TOOLS_GAP } from './note-selection-place.ts';
import { NoteSuggestions, type ManualSupplement } from './note-suggestions.tsx';
import type { NoteProposal } from './note-review.tsx';
import './note-ai.css';

export { NOTE_PREDICT_PAUSE_MS, NOTE_INTERJECT_PAUSE_MS } from './note-suggestions.tsx';
export interface NoteRange { from: number; to: number }
interface DraftTarget {
  doc: DocumentNode;
  base: string;
  json: JSONContent;
  range: NoteRange | null;
  selected: string;
  before: string;
  after: string;
}
const BUBBLE_WIDTH = 400;
/** 还没画出来时按一行按钮估高度（桌面 32 + 内边距；手机按钮 40）；画出来以后用实际高度。 */
const BUBBLE_HEIGHT = 44;
const PHONE_BUBBLE_HEIGHT = 52;

function capture(editor: Editor, range: NoteRange | null): DraftTarget {
  const doc = editor.state.doc;
  const serialize = (from: number, to = doc.content.size): string =>
    editor.storage.markdown.manager.serialize(doc.cut(from, to).toJSON());
  return { doc, base: editor.getMarkdown(), json: editor.getJSON(), range,
    selected: range === null ? '' : serialize(range.from, range.to),
    before: range === null ? '' : serialize(0, range.from).slice(-NOTE_ASSIST_CONTEXT_CHARS),
    after: range === null ? '' : serialize(range.to).slice(0, NOTE_ASSIST_CONTEXT_CHARS),
  };
}

export function NoteAi({ editor, noteId, onProposal, pending, onQuote }: {
  editor: Editor; noteId: string; onProposal: (proposal: NoteProposal) => void;
  pending: boolean; onQuote: (range: NoteRange) => void;
}): ReactNode {
  const api = useApi();
  const { notesUi } = useClientState();
  const { predict, interject } = useStore(notesUi.store);
  const [supplement, setSupplement] = useState<ManualSupplement | null>(null);
  const [selection, setSelection] = useState<NoteRange | null>(null);
  const [bubble, setBubble] = useState<{ left: number; top: number; width: number } | null>(null);
  const [target, setTarget] = useState<DraftTarget | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [automaticError, setAutomaticError] = useState<string | null>(null);
  const manual = useRef<AbortController | null>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const lastRequest = useRef<{
    action: NoteAssistRequest['action']; draft: DraftTarget; instruction: string;
  } | null>(null);
  useEffect(() => () => manual.current?.abort(), [editor, noteId]);

  useEffect(() => {
    const locate = (): void => {
      const dom = editorDom(editor);
      if (dom === null || editor.state.selection.empty) { setBubble(null); return; }
      const { from, to } = editor.state.selection;
      const bounds = (dom.closest('.note-pane') ?? dom).getBoundingClientRect();
      const viewport = window.visualViewport;
      const phone = window.innerWidth < PHONE_BELOW;
      const paneLeft = Math.max(SELECTION_TOOLS_GAP, bounds.left + SELECTION_TOOLS_GAP);
      const paneRight = Math.min(window.innerWidth - SELECTION_TOOLS_GAP, bounds.right - SELECTION_TOOLS_GAP);
      const available = paneRight > paneLeft ? paneRight - paneLeft : window.innerWidth - SELECTION_TOOLS_GAP * 2;
      const width = Math.min(BUBBLE_WIDTH, available);
      const measured = tools.current?.offsetHeight ?? 0;
      const place = placeSelectionTools(editor.view.coordsAtPos(from), editor.view.coordsAtPos(to), {
        width, height: measured > 0 ? measured : phone ? PHONE_BUBBLE_HEIGHT : BUBBLE_HEIGHT,
        paneLeft: bounds.left, paneRight: bounds.right > bounds.left ? bounds.right : window.innerWidth,
        viewportTop: viewport?.offsetTop ?? 0, viewportHeight: viewport?.height ?? window.innerHeight,
        viewportWidth: window.innerWidth, phone,
      });
      setBubble({ width, ...place });
    };
    const select = (): void => {
      const { from, to, empty } = editor.state.selection;
      setSelection(!empty && editor.state.doc.textBetween(from, to).trim() !== '' ? { from, to } : null);
      locate();
    };
    select();
    document.addEventListener('scroll', locate, true);
    window.addEventListener('resize', locate);
    window.visualViewport?.addEventListener('resize', locate);
    editor.on('selectionUpdate', select);
    editor.on('update', select);
    return () => {
      editor.off('selectionUpdate', select);
      editor.off('update', select);
      document.removeEventListener('scroll', locate, true);
      window.removeEventListener('resize', locate);
      window.visualViewport?.removeEventListener('resize', locate);
    };
  }, [editor]);

  useEffect(() => { if (target !== null) { prompt.current?.focus(); } }, [target]);
  const cancel = (): void => {
    manual.current?.abort();
    manual.current = null;
    setBusy(false);
  };
  const openPrompt = (range: NoteRange | null): void => {
    if (busy || pending || !editor.isEditable || editor.view.composing) { return; }
    setError(null);
    setTarget(capture(editor, range));
  };
  const generate = async (action: NoteAssistRequest['action'], draft: DraftTarget, extra = ''): Promise<void> => {
    if (manual.current !== null || pending || !editor.isEditable || editor.view.composing) { return; }
    if (action === 'custom' && extra.trim() === '') { return; }
    const controller = new AbortController();
    manual.current = controller;
    lastRequest.current = { action, draft, instruction: extra };
    setBusy(true);
    setBusyLabel(draft.range === null ? '正在修改整篇…' : '正在修改选段…');
    setError(null);
    setAutomaticError(null);
    try {
      const result = await api.notes.assist(noteId, { action, markdown: draft.base,
        ...(draft.range === null ? {} : { selected: draft.selected, before: draft.before, after: draft.after }),
        ...(action === 'custom' ? { instruction: extra.trim() } : {}),
      }, controller.signal);
      if (controller.signal.aborted || editor.isDestroyed) { return; }
      let candidate = result.markdown;
      if (draft.range !== null) {
        const clone = new Editor({ extensions: noteExtensions(), content: draft.json });
        try {
          clone.commands.insertContentAt(draft.range, candidate, { contentType: 'markdown' });
          candidate = clone.getMarkdown();
        } finally { clone.destroy(); }
      }
      onProposal({ base: draft.base, candidate, label: `${result.label} · ${draft.range === null ? '整篇' : '选段'}` });
      lastRequest.current = null;
      setTarget(null);
      setInstruction('');
    } catch (cause) {
      if (!controller.signal.aborted) { setError(errorText(cause)); }
    } finally {
      if (manual.current === controller) { manual.current = null; setBusy(false); }
    }
  };
  const submit = (): void => {
    if (target === null) { return; }
    if (editor.state.doc !== target.doc) {
      setError('正文已修改，请关掉修改要求后重新选择。你写下的要求会保留。');
      return;
    }
    void generate('custom', target, instruction);
  };
  const quick = (action: NoteAssistRequest['action'], range: NoteRange | null): void => {
    void generate(action, capture(editor, range));
  };
  const fullActions = [['polish', '润色'], ['organize', '整理'], ['correct', '检查与纠正'], ['format', '排版']] as const;
  const selectedActions = [['correct', '检查与纠正'], ['format', '排版'], ['chart', '图表化']] as const;
  const disabled = busy || pending;
  const visibleError = error ?? automaticError;

  return <div className="note-ai-tools">
    <div className="note-toolbar">
      <DropdownMenu label="AI 写作" className="note-menu-button" items={[
        ...fullActions.map(([action, label]) => ({
          label: `整篇${label}`, disabled, onSelect: () => quick(action, null),
        })),
        SEPARATOR,
        { label: '按要求修改全文', disabled, onSelect: () => openPrompt(null) },
      ]}>
        <Icon name="sparkles" />AI<Icon name="chevron-down" size={14} />
      </DropdownMenu>
      {/* 11-04 重做悬停：「续写」怎么采用（Tab）看名字猜不到，放进 ⓘ；「补充建议」名字自己说清了，不再解释。 */}
      <span className="note-toggle-named">
        <label className="note-toggle">
          <input type="checkbox" role="switch" checked={predict}
            onChange={(event) => notesUi.set({ predict: event.target.checked })} />续写
        </label>
        <InfoTip label="「续写」的说明" text="停笔后显示续写候选，Tab 或点击采用" side="bottom" />
      </span>
      <label className="note-toggle">
        <input type="checkbox" role="switch" checked={interject}
          onChange={(event) => notesUi.set({ interject: event.target.checked })} />补充建议
      </label>
      {busy ? <><span role="status" className="note-status">{busyLabel}</span>
        <IconButton icon="close" label="取消建议" onClick={cancel} /></> : null}
      {!pending ? null : <span className="note-status">修改稿待处理</span>}
    </div>
    {target === null ? null : <section className="note-ai-prompt" aria-label="AI 修改要求">
      <div className="note-toolbar"><strong>{target.range === null ? '修改整篇' : '修改选段'}</strong>
        <span className="note-toolbar-gap" />
        <IconButton icon="close" label="关掉修改要求" onClick={() => { cancel(); setTarget(null); }} />
      </div>
      {target.range === null ? null : <blockquote>{target.selected}</blockquote>}
      <textarea ref={prompt} aria-label="修改要求" placeholder="希望怎么改？" value={instruction}
        rows={3} maxLength={4000} disabled={busy} onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) { return; }
          if (event.key === 'Escape') { event.preventDefault(); cancel(); setTarget(null); }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
        }} />
      <div className="note-toolbar"><span className="note-status">⌘ / Ctrl + Enter</span>
        <span className="note-toolbar-gap" />
        <button className="primary-button" type="button" disabled={disabled || !instruction.trim()}
          onClick={submit}>生成修改稿</button>
      </div>
    </section>}
    {selection === null || bubble === null || target !== null || disabled ? null : createPortal(
      <div ref={tools} className="note-selection-tools" role="toolbar" aria-label="选中文字操作" style={bubble}>
        <IconButton icon="quote" label="引用到对话" onMouseDown={(event) => event.preventDefault()}
          onClick={() => { onQuote(selection); setSelection(null); }} />
        <button type="button" className="text-button" disabled={disabled}
          onMouseDown={(event) => event.preventDefault()} onClick={() => quick('polish', selection)}>润色</button>
        <button type="button" className="text-button" disabled={disabled}
          onMouseDown={(event) => event.preventDefault()} onClick={() => setSupplement((old) => ({
            ...selection, seq: (old?.seq ?? 0) + 1 }))}>补充建议</button>
        <button type="button" className="text-button" disabled={disabled} aria-label="按要求修改选段"
          onMouseDown={(event) => event.preventDefault()} onClick={() => openPrompt(selection)}>
          <Icon name="sparkles" />修改要求
        </button>
        <DropdownMenu label="更多选段操作" tip="更多" className="icon-button note-selection-more" align="end" keepFocus
          items={selectedActions.map(([action, label]) => ({
            label, disabled, onSelect: () => quick(action, selection),
          }))}>
          <Icon name="more" />
        </DropdownMenu>
      </div>, document.body)}
    <NoteSuggestions editor={editor} noteId={noteId} predict={predict} interject={interject}
      paused={busy || pending || target !== null} onError={setAutomaticError} manual={supplement}
      onStructure={(text, range) => {
        const base = editor.getMarkdown();
        const clone = new Editor({ extensions: noteExtensions(), content: editor.getJSON() });
        try {
          clone.commands.insertContentAt(range, text, { contentType: 'markdown' });
          onProposal({ base, candidate: clone.getMarkdown(), label: '结构建议' });
        } finally { clone.destroy(); }
      }} />
    {visibleError === null ? null : <div className="note-ai-error">
      <p className="note-error" role="alert">{visibleError}</p>
      {error === null || lastRequest.current === null || target !== null ? null :
        <button type="button" className="text-button" disabled={disabled} onClick={() => {
          const request = lastRequest.current;
          if (request !== null) { void generate(request.action, request.draft, request.instruction); }
        }}>重试生成</button>}
    </div>}
  </div>;
}
