// 笔记页：文件夹 | 列表 | 正文；手机上一层一层进（列表 → 正文，带返回）。
// 电脑上没选的时候默认打开列表第一篇；文件夹/列表可以独立收起，选择保留在 NotesUi。
// 「新建」的 request_id 存在 state/note-ops.ts：回执丢了再点（或点「再核实」）用的是同一个，不会建出第二篇。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { useClientState } from '../../state/context.tsx';
import { CREATE_NOTE_OP, type NoteOp } from '../../state/note-ops.ts';
import { useRememberedScroll } from '../../state/use-remembered-scroll.ts';
import { useStore } from '../../state/use-store.ts';
import { NoteEditor } from './note-editor.tsx';
import { NoteFolders, type NoteCollection } from './note-folders.tsx';
import { NoteList } from './note-list.tsx';
import { deleteNote, deleteOpNoteId } from './note-delete.ts';
import { restoreNote, restoreOpNoteId } from './note-restore.ts';
import { useNoteList, useOpenNote } from './use-notes.ts';
import { useNotesLayout } from './use-notes-layout.ts';
import './notes.css';
import './notes-workspace.css';
import { PhoneNotesHome } from './phone-notes-home.tsx';

export interface NotesViewProps {
  noteId: string | null;
  /** 地址里那一段解不开（不完整的百分号编码），原样带来，页面上说明。 */
  invalidNoteId?: string | undefined;
  phone: boolean;
  navigate: (route: Route) => void;
}

function OpenNotePane({ noteId, onDeleted }: { noteId: string | null; onDeleted: () => void }): ReactNode {
  const { notesUi } = useClientState();
  const [refresh, setRefresh] = useState(0);
  const open = useOpenNote(noteId, refresh);
  const opened = open.status === 'ready' ? open.note : null;
  useEffect(() => {
    if (opened === null || opened.id !== noteId) return;
    if (opened.deletedAt !== null) notesUi.forgetNote(opened.id);
    else notesUi.openNote(opened);
  }, [notesUi, noteId, opened?.id, opened?.title, opened?.private, opened?.deletedAt]);
  // 换了一篇时，第一轮渲染里 open 还是上一篇：只有读到的正是这一篇才算就绪，才恢复它的滚动位置。
  const ready = open.status === 'ready' && open.note.id === noteId;
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>(`notes:editor:${noteId ?? ''}`, ready);
  return (
    <div className="note-pane" ref={ref} onScroll={onScroll}>
      {open.status === 'none' ? <p className="block-empty">选一篇，或新建一篇。</p> : null}
      {open.status === 'loading' ? <p className="block-empty">正在读…</p> : null}
      {open.status === 'failed' ? (
        <p className="block-empty is-error" role="alert">
          {open.error}
          <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>
            重新读取笔记
          </button>
        </p>
      ) : null}
      {open.status !== 'ready' || open.syncError === null ? null : <p className="note-error" role="alert">
        当前显示上次保存的版本，最新内容暂未同步。{open.syncError}
        <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>重试同步</button>
      </p>}
      {open.status === 'ready' ? <NoteEditor key={open.note.id} note={open.note} onDeleted={onDeleted} /> : null}
    </div>
  );
}

/** 新建没拿到明确结果时的那一行：回执不确定给「再核实」（同一标识再发），明确失败只写原因。 */
function CreateStatus({ op, onRetry }: { op: NoteOp | undefined; onRetry: () => void }): ReactNode {
  if (op === undefined || op.status === 'running') {
    return null;
  }
  return (
    <p className="block-empty is-error" role="alert">
      {op.error}
      {op.status === 'uncertain' ? (
        <button type="button" className="text-button" onClick={onRetry}>
          再核实
        </button>
      ) : null}
    </p>
  );
}

/**
 * 删除或恢复可能已生效，原按钮会先消失，所以核实入口放在笔记页顶上。
 * 用 noteOps 里记着的笔记 id 和 request_id 再发一次；服务端按同一个标识回放结果。
 */
function PendingNoteChanges({ onDeleted }: { onDeleted: (noteId: string) => void }): ReactNode {
  const api = useApi();
  const { noteOps } = useClientState();
  const ops = useStore(noteOps.store);
  const pending = [...ops].flatMap(([key, op]) => {
    if (op.status !== 'uncertain') { return []; }
    const deletedId = deleteOpNoteId(key);
    const restoredId = restoreOpNoteId(key);
    const noteId = deletedId ?? restoredId;
    return noteId === null ? [] : [{ key, noteId, op, restoring: restoredId !== null }];
  });
  if (pending.length === 0) {
    return null;
  }
  const verify = async (noteId: string, restoring: boolean): Promise<void> => {
    if (restoring) {
      await restoreNote(api, noteOps, noteId);
    } else if (await deleteNote(api, noteOps, noteId)) {
      onDeleted(noteId);
    }
  };
  return (
    <div className="notes-pending" role="alert">
      {pending.map(({ key, noteId, op, restoring }) => (
        <p key={key} className="block-empty is-error">
          {restoring ? '恢复' : '删除'}一篇笔记的结果待核实。{op.error}
          <button type="button" className="text-button" onClick={() => void verify(noteId, restoring)}>
            再核实
          </button>
        </p>
      ))}
    </div>
  );
}

export function NotesView({ noteId, invalidNoteId, phone, navigate }: NotesViewProps): ReactNode {
  const api = useApi();
  const { noteOps, notesUi, notesCache } = useClientState();
  const createOp = useStore(noteOps.store).get(CREATE_NOTE_OP);
  const { query, collection, listHidden, activeNoteId, reading, phoneList } = useStore(notesUi.store);
  const setQuery = (query: string): void => notesUi.set({ query });
  const setCollection = (collection: NoteCollection): void => notesUi.set({ collection });
  const setListHidden = (listHidden: boolean): void => notesUi.set({ listHidden });
  const { ref: workspace, layout, measured } = useNotesLayout(phone);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [automaticReading, setAutomaticReading] = useState(false);
  const freshLink = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { notes, error, retry } = useNoteList(query, collection);
  const invalid = invalidNoteId !== undefined;
  const selectedId = (noteId === 'new' ? null : noteId) ?? (invalid || noteId === 'new' ? null
    : reading === true && activeNoteId != null ? activeNoteId
      : reading === false || phone ? null : (notes?.[0]?.id ?? null));
  const openNote = (id: string): void => {
    navigate({ view: 'notes', noteId: id });
  };
  const backToList = (): void => {
    notesUi.showList();
    setAutomaticReading(false);
    navigate({ view: 'notes', noteId: null });
  };
  const renderedLocation = window.location.hash;
  const afterDeleted = (id: string): void => {
    notesUi.forgetNote(id);
    if (mounted.current && window.location.hash === renderedLocation && id === selectedId) backToList();
  };
  const compact = layout === 'single';
  // 电脑上文件夹在笔记栏目的第二栏（11-07 两层侧栏），主区不再画。
  const showFolders = false;
  const showNote = !compact || noteId !== null || automaticReading || (reading === true && selectedId !== null);
  const showList = compact ? !showNote : !listHidden;
  const collectionLabel = collection.kind === 'folder' ? collection.name
    : collection.kind === 'deleted' ? '最近删除' : '全部';

  // 默认展开的第一篇已经在阅读时，聊天栏或缩放不能把它突然换成列表。
  // 首次就处于单栏时仍从列表进入；返回列表会清除此状态。
  useEffect(() => {
    if (measured && !compact && selectedId !== null) setAutomaticReading(true);
  }, [measured, compact, selectedId]);

  const create = async (): Promise<void> => {
    const origin = window.location.hash;
    const requestId = noteOps.begin(CREATE_NOTE_OP, createRequestId);
    try {
      const note = await api.notes.create({ markdown: '', requestId,
        ...(collection.kind === 'folder' ? { folder: collection.name } : {}),
      });
      notesCache.remember(note);
      noteOps.succeed(CREATE_NOTE_OP);
      if (mounted.current && window.location.hash === origin) {
        // 新建即落笔：编辑器挂好后自己来取这个标记并聚焦（手机上会拉起键盘，这正是要的）。
        notesUi.markFresh(note.id);
        openNote(note.id);
      }
    } catch (cause) {
      noteOps.fail(CREATE_NOTE_OP, cause);
    }
  };

  useEffect(() => {
    if (noteId !== 'new') { freshLink.current = false; return; }
    if (!freshLink.current) { freshLink.current = true; void create(); }
  }, [noteId]);

  // 手机首层（设计稿 Phone-Notes）：文件夹卡 + 最近；点了文件夹才进列表，列表页头有回首层的返回。
  if (phone && noteId === null && phoneList !== true && !invalid) {
    return (
      <div className="page notes notes-phone-home">
        <PageHeader title="笔记" phoneTools={<IconButton icon="edit" label="新建" size={17}
          disabled={createOp?.status === 'running'} onClick={() => void create()} />} />
        <CreateStatus op={createOp} onRetry={() => void create()} />
        <PendingNoteChanges onDeleted={afterDeleted} />
        <PhoneNotesHome onOpen={openNote} onCollection={(value) => {
          notesUi.set({ collection: value, phoneList: true, activeNoteId: null, reading: false });
        }} />
        {/* 文件夹操作回执待核实的那一行（NoteFolders 自己画在面板外面），首层也要看得见。 */}
        <NoteFolders value={collection} inline={false} open={foldersOpen} phone
          onClose={() => setFoldersOpen(false)} onChange={(value) => {
            setFoldersOpen(false);
            notesUi.set({ collection: value, phoneList: true, activeNoteId: null, reading: false });
          }} />
      </div>
    );
  }

  const controls = (<>
    {compact && showNote ? <button type="button" className="text-button notes-back"
      aria-label="返回笔记列表" onClick={backToList}><Icon name="back" />列表</button> : null}
    {phone ? (
      <IconButton icon="folder" label="打开文件夹" aria-expanded={foldersOpen}
        onClick={() => setFoldersOpen(true)} />
    ) : null}
    {!compact ? (
      <IconButton icon="list" label={listHidden ? '展开列表' : '收起列表'} aria-pressed={!listHidden}
        onClick={() => setListHidden(!listHidden)} />
    ) : null}
    <IconButton icon="plus" label="新建" className="notes-create"
      disabled={createOp?.status === 'running'} onClick={() => void create()} />
  </>);

  return (
    <div className="page page-fill notes">
      <PageHeader title={phone && showList ? collectionLabel : '笔记'} controls={controls}
        onBack={phone && showList ? () => notesUi.set({ phoneList: false }) : undefined} />
      <CreateStatus op={createOp} onRetry={() => void create()} />
      <PendingNoteChanges onDeleted={afterDeleted} />
      {invalid ? (
        <p className="block-empty is-error" role="alert">
          地址里的笔记标识「{invalidNoteId}」不完整，打不开。从列表里选一篇。
        </p>
      ) : null}
      <div className="notes-columns" ref={workspace} data-phone={phone} data-layout={layout}
        data-folders-visible={showFolders} data-list-visible={showList}>
        {phone ? <NoteFolders value={collection} inline={showFolders} open={foldersOpen} phone
          onClose={() => setFoldersOpen(false)} onChange={(value) => {
            setCollection(value);
            setFoldersOpen(false);
            setAutomaticReading(false);
            notesUi.set({ activeNoteId: null, reading: false });
            navigate({ view: 'notes', noteId: null });
          }} /> : null}
        <NoteList
          hidden={!showList}
          notes={notes}
          error={error}
          onRetry={retry}
          selectedId={selectedId}
          query={query}
          onQuery={setQuery}
          onOpen={openNote}
          showFolder={collection.kind === 'all'}
          collectionLabel={collectionLabel}
          heading={!phone}
          onFolders={phone ? () => setFoldersOpen(true) : undefined}
        />
        <div className="notes-detail" hidden={!showNote}>
            <OpenNotePane noteId={selectedId} onDeleted={() => {
              if (selectedId !== null) afterDeleted(selectedId);
            }} />
        </div>
      </div>
    </div>
  );
}
