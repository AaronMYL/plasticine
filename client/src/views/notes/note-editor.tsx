// 笔记正文：TipTap 编辑器 + 一行工具（保存状态 · 引用到对话 · 删除）。保存逻辑在 note-saver.ts。
// 「引用到对话」把选中的字（没选就整篇）放进右侧对话栏的输入框，不切页（《UI 方案》第 9 节）。
// 删除的 request_id 存在 state/note-ops.ts：回执丢了点「再核实」用同一个标识，服务端回放同一个结果。

import { currentComposer } from '../conversation/current-composer.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { isAiFolder, isAiNote } from './ai-folder.ts';
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
import { NoteSaver, type SaveStatus } from './note-saver.ts';
import { useNoteSync } from './use-note-sync.ts';
import { NoteReview, type NoteProposal } from './note-review.tsx';
import { NoteFormat } from './note-format.tsx';
import { NoteActions } from './note-actions.tsx';
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
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useRoute } from '../../shell/use-route.ts';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  uncertain: '结果待核实',
  failed: '保存失败',
  conflict: '有冲突',
};

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
  const width = useViewportWidth();
  const [toolsExpanded, setToolsExpanded] = useState<boolean | null>(null);
  const toolsOpen = toolsExpanded ?? width >= PHONE_BELOW;
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  const changedParagraph = useRef<HTMLElement | null>(null);
  const commandBar = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin();

  const editor = useEditor({
    extensions,
    content: saver.initialMarkdown(),
    contentType: 'markdown',
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
    onUpdate: ({ editor: current, transaction }) => {
      // 选区/建议等元数据事务可能让 TrailingNode 补编辑用空段落；仅阅读不能因此改写原 Markdown。
      if (transaction.docChanged) saver.edit(current.getMarkdown());
    },
  });

  const { syncError, retrySync, aiChanged } = useNoteSync(note, saver, editor);
  const images = useNoteImages(editor, note.id);
  const current = saver.current();
  const readOnly = current.readOnly || current.deletedAt !== null;
  useStickyTools(commandBar, scrollMargin, toolsOpen && editor !== null && !readOnly);
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  // 刚新建的那一篇：编辑器一挂上就把焦点交给正文开头，之后再打开同一篇不抢焦点（审查第 3 条）。
  useEffect(() => {
    if (editor === null || readOnly || !notesUi.takeFresh(note.id)) { return; }
    editor.commands.focus('start');
  }, [editor, readOnly, notesUi, note.id]);
  const quoteToConversation = async (range?: NoteRange): Promise<void> => {
    if (editor === null || editor.view.composing) {
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

  return (
    <div className="note-editor">
      <div className="note-meta text-meta">
        {/* 2026-11-05 设计稿 Notes：Plasticine 写的（在「Plasticine 写的」里、或最后一版是它写的）时间前面一个 ✦。 */}
        {isAiNote(current) ? <AiMark /> : null}
        {current.folder === '笔记' || isAiFolder(current.folder) ? null : (
          <span className="note-current-folder" title={current.folder}>{current.folder}</span>
        )}
        <time dateTime={current.updatedAt}>
          {localTime(current.updatedAt, timeZone)} 更新
        </time>
      </div>
      <NoteImport noteId={note.id} />
      <div className="note-toolbar note-primary-tools">
        <span className={saveState.status === 'failed' ? 'note-status is-error' : 'note-status'} role="status">
          {readOnly ? '只读' : STATUS_TEXT[saveState.status]}
        </span>
        {saveState.status !== 'uncertain' && saveState.status !== 'failed' ? null :
          <button type="button" className="text-button" onClick={() => void retrySave()}>
            {saveState.status === 'uncertain' ? '再核实' : '重试'}</button>}
        <span className="note-toolbar-gap" />
        {!readOnly ? <button type="button" className="text-button" aria-expanded={toolsOpen}
          aria-controls={`note-tools-${note.id}`} onClick={() => setToolsExpanded(!toolsOpen)}>编辑工具</button> : null}
        <IconButton icon="quote" label="引用到对话" onClick={() => void quoteToConversation()} />
        <NoteActions note={current} label="更多笔记操作" extra={[
          { label: '版本历史', icon: 'history', onSelect: () => setHistoryOpen(true) },
          { label: '笔记 AI 设置', icon: 'settings',
            onSelect: () => openPanel({ kind: 'settings', section: 'ai' }) },
          ...readOnly ? [] : [{ label: '删除笔记', icon: 'trash', onSelect: () => setConfirmDelete(true) } as const],
        ]} beforeChange={async () => {
          await saver.flush();
          return saver.readyForRefresh() ? saver.current() : null;
        }} changed={(fresh) => {
          if (saver.applyRemote(fresh)) {
            editor?.commands.setContent(fresh.markdown, { contentType: 'markdown', emitUpdate: false });
          }
        }} />
      </div>
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
        <div className="note-command-bar" ref={commandBar} id={`note-tools-${note.id}`} data-expanded={toolsOpen}>
          <NoteFormat editor={editor} upload={() => images.input.current?.click()} />
          <NoteAi editor={editor} noteId={note.id} onProposal={setProposal}
            pending={proposal !== null || saveState.conflict !== null}
            onQuote={(range) => void quoteToConversation(range)} />
        </div>
        <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple ref={images.input}
          aria-label="上传笔记图片" onChange={(event) => {
            void images.upload([...event.target.files ?? []]);
            event.target.value = '';
          }} />
        {images.busy ? <p role="status" className="note-status">图片上传中…
          <button type="button" className="text-button" onClick={images.cancel}>取消上传</button></p> : null}
        {images.error === null ? null : <p className="note-error" role="alert">{images.error}
          <button type="button" className="text-button" onClick={images.retry}>重试上传</button></p>}
      </>}
      {proposal === null ? null : <NoteReview key={`${proposal.label}:${proposal.candidate}`} proposal={proposal}
        current={() => saver.initialMarkdown()} canAdopt={() => editor !== null && !editor.view.composing}
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
      {adopted ? <p className="note-status" role="status">修改已采用 · {STATUS_TEXT[saveState.status]}{' '}
        <button type="button" className="text-button" onClick={() => {
          locateContent(changedParagraph.current); setAdopted(false);
        }}>定位修改<Icon name="chevron-down" size={12} /></button></p> : null}
      <EditorContent editor={editor} className="note-body" />
      {aiChanged ? <span className="note-ai-cursor" role="status">Plasticine · 已写入这里</span> : null}
      {historyOpen ? (
        <NoteVersions saver={saver} onClose={() => setHistoryOpen(false)} onRestored={syncEditor} />
      ) : null}
    </div>
  );
}
