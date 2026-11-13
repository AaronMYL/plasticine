// 笔记正文：TipTap 编辑器 + 一行工具（保存状态 · 引用到对话 · 删除）。保存逻辑在 note-saver.ts。
// 「引用到对话」把选中的字（没选就整篇）放进右侧对话栏的输入框，不切页（《UI 方案》第 9 节）。
// 删除的 request_id 存在 state/note-ops.ts：回执丢了点「再核实」用同一个标识，服务端回放同一个结果。

import { currentComposer } from '../conversation/current-composer.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { isAiNote } from './ai-folder.ts';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { NoteView } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { deleteNoteOp, restoreNoteOp } from '../../state/note-ops.ts';
import { deleteNote } from './note-delete.ts';
import { restoreNote } from './note-restore.ts';
import { useStore } from '../../state/use-store.ts';
import { useTelemetry } from '../../telemetry.ts';
import { noteExtensions } from './editor-extensions.ts';
import { NoteSaver } from './note-saver.ts';
import { noteComposing, trackComposition } from './note-composition.ts';
import { CLIENT_BUILD_ID } from '../../shell/client-update.tsx';
import { useEditorDom } from './editor-dom.ts';
import { useNoteSync } from './use-note-sync.ts';
import { NoteReview, type NoteProposal } from './note-review.tsx';
import { NoteFormat } from './note-format.tsx';
import { NoteActions } from './note-actions.tsx';
import { SaveState } from './note-save-state.tsx';
import { useScrollMargin, useStickyTools } from './use-sticky-tools.ts';
import { NoteAi, type NoteRange } from './note-ai.tsx';
import { NoteImport } from './note-import.tsx';
import { useNoteImages } from './note-images.ts';
import { useTimeZone } from '../../live.tsx';
import { localTime } from '../device/format.ts';
import { NoteVersions } from './note-versions.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { buildNoteQuote } from './note-quote.ts';
import { useOpenPanel } from '../../shell/panel.ts';
import { locateContent } from '../../shell/locate-content.ts';
import { Icon } from '../../shell/icons.tsx';
import { useRoute } from '../../shell/use-route.ts';
import { useQuoteHandler } from '../../shell/quote-registry.ts';

/** 「已采用修改 · 定位」停多久。 */
const ADOPTED_SHOWN_MS = 5000;


export interface NoteEditorProps {
  note: NoteView;
  onDeleted: () => void;
}

function useSaver(note: NoteView): NoteSaver {
  const api = useApi();
  const { noteDrafts, actionOps, notesCache } = useClientState();
  const [saver] = useState(
    () =>
      new NoteSaver({
        note,
        drafts: noteDrafts,
        save: (id, input) => api.notes.save(id, input),
        newRequestId: createRequestId,
        actionOps,
        onSaved: (saved) => notesCache.remember(saved),
      }),
  );
  useEffect(() => () => saver.dispose(), [saver]);
  return saver;
}

export function NoteEditor({ note, onDeleted }: NoteEditorProps): ReactNode {
  const api = useApi();
  const telemetry = useTelemetry();
  const timeZone = useTimeZone();
  const openPanel = useOpenPanel();
  const targetState = useClientState();
  const { noteOps, shellPrefs, notesUi } = targetState;
  const { route } = useRoute();
  const saver = useSaver(note);
  const saveState = useStore(saver.state);
  const deleteKey = deleteNoteOp(note.id);
  const deleteOp = useStore(noteOps.store).get(deleteKey);
  const restoreOp = useStore(noteOps.store).get(restoreNoteOp(note.id));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [extensions] = useState(noteExtensions);
  const [proposal, setProposal] = useState<NoteProposal | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  // 「已采用修改」几秒后自己收起（11-12 第 6 条）。
  useEffect(() => {
    if (!adopted) return undefined;
    const timer = window.setTimeout(() => setAdopted(false), ADOPTED_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [adopted]);
  const changedParagraph = useRef<HTMLElement | null>(null);
  const commandBar = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin();

  // 编辑器的配置只在建的时候定一次。TipTap 每次渲染都拿新配置和旧的逐项比，有一项不是同一个对象就 setOptions
  // （view.setProps + view.updateState）；以前 editorProps 每次是新对象、content 跟着草稿变，等于每次渲染都重设，
  // 输入法组字期间保存状态一变也会触发。之后的可编辑状态由下面的 setEditable 管。
  const [initial] = useState(() => ({
    content: saver.initialMarkdown(),
    editable: !note.readOnly && note.deletedAt === null,
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': '笔记正文', spellcheck: 'false' },
      // 光标滚进视野时让开固定在顶上的工具栏（use-sticky-tools.ts 按工具栏的高度改这个对象）。
      scrollMargin,
      scrollThreshold: scrollMargin,
      handleDOMEvents: {
        compositionstart: () => {
          saver.setComposing(true);
          return false;
        },
        compositionend: () => {
          saver.setComposing(false);
          return false;
        },
      },
    },
  }));
  const editor = useEditor({
    extensions,
    content: initial.content,
    contentType: 'markdown',
    editable: initial.editable,
    editorProps: initial.editorProps,
    onUpdate: ({ editor: current, transaction }) => {
      // 选区/建议等元数据事务可能让 TrailingNode 补编辑用空段落；仅阅读不能因此改写原 Markdown。
      if (transaction.docChanged) saver.edit(current.getMarkdown());
    },
  });

  const { syncError, retrySync, aiChanged } = useNoteSync(note, saver, editor);
  const images = useNoteImages(editor, note.id);
  const current = saver.current();
  const readOnly = current.readOnly || current.deletedAt !== null;
  useStickyTools(commandBar, scrollMargin, editor !== null && !readOnly);
  useEffect(() => {
    if (editor !== null && editor.isEditable === readOnly) { editor.setEditable(!readOnly, false); }
  }, [editor, readOnly]);
  const editorNode = useEditorDom(editor);
  useEffect(() => {
    if (editor === null || editorNode === null) { return undefined; }
    return trackComposition(editor, editorNode);
  }, [editor, editorNode]);
  // 刚新建的那一篇：编辑器一挂上就把焦点交给正文开头，之后再打开同一篇不抢焦点（审查第 3 条）。
  useEffect(() => {
    if (editor === null || readOnly || !notesUi.takeFresh(note.id)) { return; }
    editor.commands.focus('start');
  }, [editor, readOnly, notesUi, note.id]);
  const quoteToConversation = async (range?: NoteRange): Promise<void> => {
    if (editor === null || noteComposing(editor)) {
      return;
    }
    const document = editor.state.doc;
    const { from, to } = range ?? editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, '\n');
    const hasSelection = selected.trim() !== '';
    const quoteTarget = targetState.dockTargets.store.get().lineId;
    const composer = currentComposer(targetState);
    setQuoteStatus('正在确认引用版本…');
    await saver.flush();
    if (editor.isDestroyed) return;
    if (targetState.dockTargets.store.get().lineId !== quoteTarget) {
      setQuoteStatus('对话对象变了，请重新引用。'); return;
    }
    if (!saver.readyForRefresh() || !document.eq(editor.state.doc)) {
      setQuoteStatus('正文仍在修改或尚未保存，处理保存状态后再引用。'); return;
    }
    try {
      composer.ui.addQuote(buildNoteQuote(saver.current(), !hasSelection ? {}
        : { selection: selected, selectionKey: `${from}_${to}` }));
    } catch (cause) { setQuoteStatus(errorText(cause)); return; }
    setQuoteStatus(null);
    telemetry.track('note.quoted', { selection: hasSelection });
    if (from !== to) { editor.commands.setTextSelection(to); }
    if (window.innerWidth < PHONE_BELOW) { shellPrefs.setPhoneChatOpen(true); }
    else { shellPrefs.setChatOpen(true); }
    requestAnimationFrame(() => window.dispatchEvent(new Event('plasticine:focus-composer')));
  };

  useQuoteHandler(() => editor?.view.dom ?? null, editor === null ? null : () => {
    void quoteToConversation();
    return true;
  });

  const remove = async (): Promise<void> => {
    if (await deleteNote(api, noteOps, note.id)) {
      onDeleted();
    }
  };

  const takeTheirs = (): void => {
    const markdown = saver.takeTheirs();
    editor?.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
  };

  const syncEditor = (): void => {
    editor?.commands.setContent(saver.initialMarkdown(), { contentType: 'markdown', emitUpdate: false });
  };

  const retrySave = async (): Promise<void> => {
    await saver.flush();
    syncEditor();
  };

  const actions = <NoteActions note={current} label="更多笔记操作" extra={[
    { label: '版本历史', icon: 'history', onSelect: () => setHistoryOpen(true) },
    ...readOnly ? [] : [{ label: '删除笔记', icon: 'trash', onSelect: () => setConfirmDelete(true) } as const],
  ]} beforeChange={async () => {
    await saver.flush();
    return saver.readyForRefresh() ? saver.current() : null;
  }} changed={(fresh) => {
    if (saver.applyRemote(fresh)) {
      editor?.commands.setContent(fresh.markdown, { contentType: 'markdown', emitUpdate: false });
    }
  }} />;
  // 11-12 第 6 条：保存状态、引用、⋯ 和格式、AI 在同一行；时间进保存图标的悬停说明，出错才常显文字和「重试」。
  const barEnd = <div className="note-bar-end">
    {isAiNote(current) ? <AiMark /> : null}
    <SaveState status={readOnly ? 'readonly' : saveState.status}
      when={`${localTime(current.updatedAt, timeZone)} 更新`} onRetry={() => void retrySave()} />
    <IconButton icon="quote" label="引用到对话" onClick={() => void quoteToConversation()} />
    {actions}
  </div>;

  return (
    <div className="note-editor">
      <NoteImport noteId={note.id} />
      {editor === null || readOnly ? <div className="note-command-bar" data-readonly="true">{barEnd}</div> : <>
        <div className="note-command-bar" ref={commandBar} role="toolbar" aria-label="编辑工具">
          <NoteFormat editor={editor} upload={() => images.input.current?.click()} />
          <NoteAi editor={editor} noteId={note.id} onProposal={setProposal}
            pending={proposal !== null || saveState.conflict !== null}
            onQuote={(range) => void quoteToConversation(range)} />
          {barEnd}
        </div>
        <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple ref={images.input}
          aria-label="上传笔记图片" onChange={(event) => {
            void images.upload([...event.target.files ?? []]);
            event.target.value = '';
          }} />
      </>}
      {current.deletedAt === null ? null : <div className="banner">
        <span>这篇笔记在最近删除中。恢复后回到「{current.folder}」。</span>
        <button type="button" className="chip-button" disabled={restoreOp?.status === 'running'}
          onClick={() => void restoreNote(api, noteOps, note.id)}>
          恢复笔记
        </button>
        {restoreOp?.status !== 'failed' ? null : <p className="note-error" role="alert">{restoreOp.error}</p>}
      </div>}

      {quoteStatus === null ? null : <p className="note-status" role="status">{quoteStatus}</p>}
      {!readOnly && confirmDelete ? <div className="note-toolbar" role="group" aria-label="确认删除笔记">
          <>
            <button type="button" className="chip-button" onClick={() => void remove()}>
              移到最近删除
            </button>
            <button type="button" className="text-button text-button-quiet" onClick={() => setConfirmDelete(false)}>
              先不
            </button>
          </>
      </div> : null}
      {saveState.error === null ? null : <p className="note-error">{saveState.error}</p>}
      {syncError === null ? null : (
        <p className="note-error" role="alert">
          同步待核实：别处的新版本没读到，你这边的字都还在。{syncError}
          <button type="button" className="text-button" onClick={retrySync}>
            重试
          </button>
        </p>
      )}
      {/* 回执不确定的删除由笔记页顶上的「待核实的删除」显示和核实（那一篇可能已经不在列表里了）。 */}
      {deleteOp?.status !== 'failed' ? null : (
        <p className="note-error" role="alert">
          {deleteOp.error}
        </p>
      )}
      {saveState.conflict === null ? null : (
        <div>
          <p className="banner" role="alert">这篇笔记在别处保存了新版本（第 {saveState.conflict.version} 版）。你的草稿还在。</p>
          <NoteReview key={`conflict:${saveState.conflict.version}`} conflict
            proposal={{ base: saver.initialMarkdown(), candidate: saveState.conflict.markdown, label: '保存冲突 · 对照新版本' }}
            current={() => saver.initialMarkdown()} onAdopt={(markdown) => {
              editor?.commands.setContent(markdown, { contentType: 'markdown' });
              void saver.resolveWith(markdown);
            }} onKeep={() => void saver.keepMine()} onUseNew={takeTheirs} />
        </div>
      )}
      {editor === null || readOnly ? null : <>
        {images.busy ? <p role="status" className="note-status">图片上传中…
          <button type="button" className="text-button" onClick={images.cancel}>取消上传</button></p> : null}
        {images.error === null ? null : <p className="note-error" role="alert">{images.error}
          <button type="button" className="text-button" onClick={images.retry}>重试上传</button></p>}
      </>}
      {proposal === null ? null : <NoteReview key={`${proposal.label}:${proposal.candidate}`} proposal={proposal}
        current={() => saver.initialMarkdown()} canAdopt={() => editor !== null && !noteComposing(editor)}
        onAdopt={(markdown) => {
          const before = Array.from(editor?.view.dom.children ?? []).map((node) => node.textContent);
          editor?.commands.setContent(markdown, { contentType: 'markdown' });
          const paragraphs = Array.from(editor?.view.dom.children ?? []);
          const changed = paragraphs.find((node, index) => node.textContent !== before[index]);
          changedParagraph.current = changed instanceof HTMLElement ? changed : editor?.view.dom ?? null;
          locateContent(changedParagraph.current, false);
          setProposal(null);
          setAdopted(true);
        }} onKeep={() => setProposal(null)} />}
      {adopted ? <p className="note-adopted" role="status"><Icon name="check" size={14} />已采用修改{' '}
        <button type="button" className="text-button" onClick={() => {
          locateContent(changedParagraph.current); setAdopted(false);
        }}>定位</button></p> : null}
      <EditorContent editor={editor} className="note-body" />
      {aiChanged ? <span className="note-ai-cursor" role="status">Plasticine · 已写入这里</span> : null}
      {historyOpen ? (
        <NoteVersions saver={saver} onClose={() => setHistoryOpen(false)} onRestored={syncEditor} />
      ) : null}
    </div>
  );
}
