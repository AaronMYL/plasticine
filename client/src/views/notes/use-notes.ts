// 笔记页只订阅当前查询/正文；缓存与在途请求留在共享状态里，切页不再闪空。
import { useEffect, useMemo, useRef } from 'react';
import { useApi } from '../../api/context.tsx';
import type { NoteMetaView, NoteView } from '../../api/types.ts';
import { useClientState } from '../../state/context.tsx';
import { EMPTY_NOTE, EMPTY_NOTE_LIST, noteListKey } from '../../state/notes-cache.ts';
import { useStore } from '../../state/use-store.ts';
import type { NoteCollection } from './note-folders.tsx';

/** 搜索框停打 250ms 再查，已缓存的相同查询可以立即回显。 */
const SEARCH_DEBOUNCE_MS = 250;

export function useNoteList(query: string, collection: NoteCollection): {
  notes: NoteMetaView[] | null; error: string | null; retry: () => void;
} {
  const api = useApi();
  const { notesCache } = useClientState();
  const lists = useStore(notesCache.lists);
  const folder = collection.kind === 'folder' ? collection.name : undefined;
  const kind = collection.kind;
  const search = useMemo(() => ({ q: query,
    ...(folder === undefined ? {} : { folder }),
    ...(kind === 'deleted' ? { deletedOnly: true } : {}),
  }), [query, folder, kind]);
  const value = lists.get(noteListKey(search)) ?? EMPTY_NOTE_LIST;
  useEffect(() => {
    let release: (() => void) | undefined;
    const timer = setTimeout(() => { release = notesCache.observeList(api.notes, search); },
      query.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); release?.(); };
  }, [api, notesCache, search, query]);
  const retry = (): void => { void notesCache.loadList(api.notes, search, true); };
  return { notes: value.notes, error: value.error, retry };
}

export type OpenNote =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; note: NoteView; revalidating: boolean; syncError: string | null }
  | { status: 'failed'; error: string };

export function useOpenNote(id: string | null, refresh = 0): OpenNote {
  const api = useApi();
  const { notesCache } = useClientState();
  const notes = useStore(notesCache.store);
  const previousRefresh = useRef(refresh);
  useEffect(() => {
    const force = previousRefresh.current !== refresh;
    previousRefresh.current = refresh;
    if (id === null) { return; }
    const release = notesCache.observeNote(api.notes, id);
    if (force) { void notesCache.loadNote(api.notes, id, true); }
    return release;
  }, [api, notesCache, id, refresh]);
  if (id === null) { return { status: 'none' }; }
  const value = notes.get(id) ?? EMPTY_NOTE;
  if (value.note !== null) {
    return { status: 'ready', note: value.note, revalidating: value.loading, syncError: value.error };
  }
  if (value.error !== null) { return { status: 'failed', error: value.error }; }
  return { status: 'loading' };
}
