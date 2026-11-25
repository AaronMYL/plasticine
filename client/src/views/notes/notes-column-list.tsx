import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { ColumnCollapseButton } from '../../shell/columns/column-toggle.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import type { Route } from '../../shell/routes.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { notesBatch } from '../bulk/bulk-api.ts';
import { useBulkSelection } from '../bulk/use-bulk-selection.ts';
import { NoteFolders, type NoteCollection } from './note-folders.tsx';
import { NoteList } from './note-list.tsx';
import { useNoteList } from './use-notes.ts';
import './notes.css';
import './notes-workspace.css';

export function collectionLabel(collection: NoteCollection): string {
  return collection.kind === 'folder' ? collection.name : collection.kind === 'deleted' ? '最近删除' : '全部';
}

export function NotesListColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const api = useApi();
  const { notesUi } = useClientState();
  const { query, collection, activeNoteId, reading } = useStore(notesUi.store);
  const { notes, error, retry } = useNoteList(query, collection);
  const selection = useBulkSelection({ items: (notes ?? []).map((note) => ({ kind: 'note', id: note.id,
    title: note.title || '未命名' })), run: (input) => notesBatch(api.notes, input),
    empty: (input) => api.notes.emptyTrash(input), onChanged: retry, scope: JSON.stringify([query, collection]) });
  const toggle = useRef<HTMLElement | null>(null);
  const [folders, setFolders] = useState<PopoverAnchor | null>(null);
  const opened = route.view === 'notes' && route.noteId !== null && route.noteId !== 'new' ? route.noteId : null;
  const choose = (value: NoteCollection): void => {
    setFolders(null);
    notesUi.set({ collection: value, activeNoteId: null, reading: true });
    navigate({ view: 'notes', noteId: null });
  };
  return (
    <>
      <NoteList selection={selection} trash={collection.kind === 'deleted'} feedback
        folders={[...new Set((notes ?? []).map((note) => note.folder))]}
        notes={notes} error={error} onRetry={retry}
        selectedId={opened ?? (reading === true ? activeNoteId ?? null : null)}
        query={query} onQuery={(value) => notesUi.set({ query: value })}
        onOpen={(id) => navigate({ view: 'notes', noteId: id })}
        showFolder={collection.kind === 'all'} collectionLabel={collectionLabel(collection)}
        foldersOpen={folders !== null}
        onFolders={(button) => {
          toggle.current = button;
          setFolders((current) => current === null ? anchorOf(button) : null);
        }}
        tools={collection.kind === 'deleted' ? undefined
          : <IconButton icon="plus" label="新建笔记" onClick={() => navigate({ view: 'notes', noteId: 'new' })} />}
        trail={<ColumnCollapseButton />}
        onCreate={() => navigate({ view: 'notes', noteId: 'new' })}
        importFolder={collection.kind === 'folder' ? collection.name : null}
      />
      <NoteFolders value={collection} inline={false} onChange={choose}
        menu={folders === null ? null : { anchor: folders, trigger: toggle, onClose: () => setFolders(null) }} />
    </>
  );
}
