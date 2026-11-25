import { invalidateQueries } from '../../state/live-query.ts';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';

const revision = new Store(0);

const LIBRARY_KEYS = ['library.', 'spaces.', 'subscriptions.', 'books.'];

export function libraryChanged(): void {
  revision.set((value) => value + 1);
  invalidateQueries((key) => LIBRARY_KEYS.some((prefix) => key.startsWith(prefix)));
}

export function useLibraryRevision(): number {
  return useStore(revision);
}
