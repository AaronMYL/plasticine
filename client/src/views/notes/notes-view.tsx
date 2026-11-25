import { useBulkSelection } from '../bulk/use-bulk-selection.ts';
import { notesBatch } from '../bulk/bulk-api.ts';
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
import { collectionLabel as labelOf } from './notes-column-list.tsx';
import { deleteNote, deleteOpNoteId } from './note-delete.ts';
import { restoreNote, restoreOpNoteId } from './note-restore.ts';
import { useNoteList, useOpenNote } from './use-notes.ts';
import './notes.css';
import './notes-workspace.css';
import { PhoneNotesHome } from './phone-notes-home.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

export interface NotesViewProps {
  noteId: string | null;
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
  }, [notesUi, noteId, opened?.id, opened?.title, opened?.deletedAt]);
  const ready = open.status === 'ready' && open.note.id === noteId;
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>(`notes:editor:${noteId ?? ''}`, ready);
  return (
    <div className="note-pane" ref={ref} onScroll={onScroll}>
      {open.status === 'none' ? <p className="block-empty">选一篇，或新建一篇。</p> : null}
      {open.status === 'loading' ? <PageLoading page /> : null}
      {open.status === 'failed' ? (
        <p className="block-empty is-error" role="alert">
          {open.error}
          <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>
            再读一次笔记
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
  const { query, collection, activeNoteId, reading, phoneList } = useStore(notesUi.store);
  const setQuery = (query: string): void => notesUi.set({ query });
  const setCollection = (collection: NoteCollection): void => notesUi.set({ collection });
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [automaticReading, setAutomaticReading] = useState(false);
  const freshLink = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { notes, error, retry } = useNoteList(query, collection);
  const selection = useBulkSelection({ items: (notes ?? []).map((note) => ({ kind: 'note', id: note.id,
    title: note.title || '未命名' })), run: (input) => notesBatch(api.notes, input),
    empty: (input) => api.notes.emptyTrash(input), onChanged: retry, scope: JSON.stringify([query, collection]) });
  const invalid = invalidNoteId !== undefined;
  const firstId = reading === false || phone ? null : (notes?.[0]?.id ?? null);
  const fallbackId = reading === true && activeNoteId != null ? activeNoteId : firstId;
  const selectedId = (noteId === 'new' ? null : noteId) ?? (invalid || noteId === 'new' ? null : fallbackId);
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
  const showNote = phone ? !selection.active
    && (noteId !== null || automaticReading || (reading === true && selectedId !== null)) : true;
  const showList = phone && (selection.active || !showNote);
  const collectionLabel = labelOf(collection);

  useEffect(() => {
    if (!phone && selectedId !== null) setAutomaticReading(true);
  }, [phone, selectedId]);

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
        notesUi.markFresh(note.id);
        openNote(note.id);
      }
    } catch (cause) {
      noteOps.fail(CREATE_NOTE_OP, cause);
      if (mounted.current && window.location.hash === origin && origin === '#/notes/new') {
        navigate({ view: 'notes', noteId: null });
      }
    }
  };

  useEffect(() => {
    if (noteId !== 'new') {
      freshLink.current = false;
      return;
    }
    if (!freshLink.current) {
      freshLink.current = true;
      void create();
    }
  }, [noteId]);

  if (phone && noteId === null && phoneList !== true && !invalid) {
    return (
      <div className="page notes notes-phone-home">
        <PageHeader title="笔记" phoneTools={<IconButton icon="edit" label="新建" size={20}
          disabled={createOp?.status === 'running'} onClick={() => void create()} />} />
        <CreateStatus op={createOp} onRetry={() => void create()} />
        <PendingNoteChanges onDeleted={afterDeleted} />
        <PhoneNotesHome onOpen={openNote} onCollection={(value) => {
          notesUi.set({ collection: value, phoneList: true, activeNoteId: null, reading: false });
        }} />
        <NoteFolders value={collection} inline={false} open={foldersOpen} phone
          onClose={() => setFoldersOpen(false)} onChange={(value) => {
            setFoldersOpen(false);
            notesUi.set({ collection: value, phoneList: true, activeNoteId: null, reading: false });
          }} />
      </div>
    );
  }

  const controls = (<>
    {showNote ? <button type="button" className="text-button notes-back"
      aria-label="返回笔记列表" onClick={backToList}><Icon name="back" />列表</button> : null}
    <IconButton icon="folder" label="打开文件夹" aria-expanded={foldersOpen}
      onClick={() => setFoldersOpen(true)} />
    <IconButton icon="plus" label="新建" className="notes-create"
      disabled={createOp?.status === 'running'} onClick={() => void create()} />
  </>);

  return (
    <div className="page page-fill notes">
      {phone ? <PageHeader title={showList ? collectionLabel : '笔记'} controls={controls}
        onBack={showList ? () => notesUi.set({ phoneList: false }) : undefined} />
        : <h1 className="sr-only">笔记</h1>}
      <CreateStatus op={createOp} onRetry={() => void create()} />
      <PendingNoteChanges onDeleted={afterDeleted} />
      {invalid ? (
        <p className="block-empty is-error" role="alert">
          地址里的笔记标识「{invalidNoteId}」不完整，打不开。从列表里选一篇。
        </p>
      ) : null}
      <div className="notes-columns" data-phone={phone} data-layout={phone ? 'single' : 'wide'}
        data-folders-visible={false} data-list-visible={showList}>
        {phone ? <NoteFolders value={collection} inline={false} open={foldersOpen} phone
          onClose={() => setFoldersOpen(false)} onChange={(value) => {
            setCollection(value);
            setFoldersOpen(false);
            setAutomaticReading(false);
            notesUi.set({ activeNoteId: null, reading: false });
            navigate({ view: 'notes', noteId: null });
          }} /> : null}
        {phone ? <NoteList selection={selection} trash={collection.kind === 'deleted'} feedback
          folders={[...new Set((notes ?? []).map((note) => note.folder))]}
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
          heading={false}
          onFolders={() => setFoldersOpen(true)}
          onCreate={() => void create()}
          importFolder={collection.kind === 'folder' ? collection.name : null}
        /> : null}
        <div className="notes-detail" hidden={!showNote}>
          <OpenNotePane noteId={selectedId} onDeleted={() => {
            if (selectedId !== null) afterDeleted(selectedId);
          }} />
        </div>
      </div>
    </div>
  );
}
