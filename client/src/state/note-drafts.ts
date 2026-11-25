import { Store } from './store.ts';

export interface NoteDraft {
  noteId: string;
  baseVersion: number;
  markdown: string;
}

export class NoteDrafts {
  readonly store = new Store<ReadonlyMap<string, NoteDraft>>(new Map());
  readonly savers = new Set<{ flush(): Promise<void>; readyForRefresh(): boolean }>();
  edits = 0;

  get(noteId: string): NoteDraft | undefined {
    return this.store.get().get(noteId);
  }

  put(draft: NoteDraft): void {
    if (this.get(draft.noteId)?.markdown !== draft.markdown) { this.edits += 1; }
    this.store.set((drafts) => {
      const next = new Map(drafts);
      next.set(draft.noteId, draft);
      return next;
    });
  }

  clear(noteId: string): void {
    this.store.set((drafts) => {
      if (!drafts.has(noteId)) {
        return drafts;
      }
      const next = new Map(drafts);
      next.delete(noteId);
      return next;
    });
  }

  hasAny(): boolean {
    return this.store.get().size > 0;
  }
}
