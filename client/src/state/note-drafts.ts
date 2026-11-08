// 还没保存上的笔记草稿。切到别的笔记、别的视图再回来，编辑器从这里恢复，不丢字。
// 只在内存里：刷新页面前由壳提醒（beforeunload），草稿不当成已保存发出去。

import { Store } from './store.ts';

export interface NoteDraft {
  noteId: string;
  /** 这份草稿基于的服务端版本；保存时作为 version（SaveNoteRequest）。 */
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
