import type { NotesApi } from '../api/client.ts';
import { errorText } from '../api/errors.ts';
import type { NoteFoldersView } from '../api/shared.ts';
import type { LiveEvent } from '../api/types.ts';
import { Store } from './store.ts';

type FoldersApi = Pick<NotesApi, 'folders'>;
type Hub = { on: (listener: (event: LiveEvent) => void) => () => void };

export interface NoteFoldersSnapshot {
  folders: NoteFoldersView | null;
  error: string | null;
}

const EMPTY: NoteFoldersSnapshot = { folders: null, error: null };

function sameFolders(a: NoteFoldersView | null, b: NoteFoldersView): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export class NoteFoldersCache {
  readonly store = new Store<NoteFoldersSnapshot>(EMPTY);
  private readonly api: FoldersApi;
  private readers = 0;
  private flight: AbortController | null = null;
  private generation = 0;
  private off: (() => void) | null = null;

  constructor(api: FoldersApi) {
    this.api = api;
  }

  observe(hub: Hub): () => void {
    this.readers += 1;
    if (this.off === null) {
      this.off = hub.on((event) => {
        if (event.type.startsWith('note.') || event.type === 'resync') {
          void this.load();
        }
      });
    }
    void this.load();
    return () => {
      this.readers -= 1;
      if (this.readers > 0) {
        return;
      }
      this.off?.();
      this.off = null;
      this.flight?.abort();
      this.flight = null;
    };
  }

  load(): Promise<void> {
    this.flight?.abort();
    const controller = new AbortController();
    this.flight = controller;
    const current = ++this.generation;
    return this.api.folders(controller.signal).then((folders) => {
      if (controller.signal.aborted || current !== this.generation) {
        return;
      }
      const previous = this.store.get();
      if (sameFolders(previous.folders, folders) && previous.error === null) {
        return;
      }
      this.store.set({ folders: sameFolders(previous.folders, folders) ? previous.folders : folders, error: null });
    }, (cause: unknown) => {
      if (controller.signal.aborted || current !== this.generation) {
        return;
      }
      this.store.set({ folders: this.store.get().folders, error: errorText(cause) });
    });
  }
}

const caches = new WeakMap<FoldersApi, NoteFoldersCache>();

export function noteFoldersCache(api: FoldersApi): NoteFoldersCache {
  let cache = caches.get(api);
  if (cache === undefined) {
    cache = new NoteFoldersCache(api);
    caches.set(api, cache);
  }
  return cache;
}
