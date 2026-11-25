import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

const NotesUiSchema = Type.Object({
  query: Type.String(),
  collection: Type.Union([Type.Object({ kind: Type.Enum(['all', 'deleted']) }),
    Type.Object({ kind: Type.Literal('folder'), name: Type.String() })]),
  foldersHidden: Type.Boolean(), listHidden: Type.Boolean(),
  predict: Type.Boolean(), interject: Type.Boolean(),
  activeNoteId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reading: Type.Optional(Type.Boolean()),
  phoneList: Type.Optional(Type.Boolean()),
  recentNotes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), title: Type.String(),
    openedAt: Type.String() }))),
});
export type NotesUiState = Static<typeof NotesUiSchema> & { freshNoteId?: string };
export type NoteCollection = NotesUiState['collection'];
const KEY = 'plasticine:notes-ui';
const MERGED_NOTE_FOLDER = '已合并（原版）';
const EMPTY: NotesUiState = { query: '', collection: { kind: 'all' }, foldersHidden: false,
  listHidden: false, predict: true, interject: false };

export class NotesUi {
  readonly store: Store<NotesUiState>;
  constructor(storage: KeyValueStorage | null = null, previousStorage: KeyValueStorage | null = null) {
    let initial = EMPTY;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(KEY) ?? previousStorage?.getItem(KEY) ?? 'null');
      if (Value.Check(NotesUiSchema, saved)) {
        initial = saved.collection.kind === 'folder' && saved.collection.name === MERGED_NOTE_FOLDER
          ? { ...saved, collection: { kind: 'all' } } : saved;
      }
    } catch { console.warn('笔记阅读位置未能恢复，可以继续使用。'); }
    this.store = new Store(initial);
    this.store.subscribe(() => {
      const { freshNoteId: _memoryOnly, ...saved } = this.store.get();
      try { storage?.setItem(KEY, JSON.stringify(saved)); }
      catch { console.warn('笔记阅读位置未能保存，当前操作不受影响。'); }
    });
  }
  set(patch: Partial<NotesUiState>): void {
    this.store.set((current) => ({ ...current, ...patch }));
  }
  openNote(note: { id: string; title: string }): void {
    const current = this.store.get();
    const recent = current.recentNotes ?? [];
    if (current.activeNoteId === note.id && current.reading === true
      && recent[0]?.id === note.id && recent[0].title === (note.title || '未命名')) return;
    this.set({ activeNoteId: note.id, reading: true,
      recentNotes: [{ id: note.id, title: note.title || '未命名', openedAt: new Date().toISOString() },
        ...recent.filter((row) => row.id !== note.id)].slice(0, 3) });
  }
  showList(): void { this.set({ activeNoteId: null, reading: false }); }
  markFresh(id: string): void { this.set({ freshNoteId: id }); }
  takeFresh(id: string): boolean {
    if (this.store.get().freshNoteId !== id) { return false; }
    this.store.set(({ freshNoteId: _taken, ...rest }) => rest);
    return true;
  }
  forgetNote(id: string): void {
    const current = this.store.get();
    this.set({ recentNotes: (current.recentNotes ?? []).filter((row) => row.id !== id),
      ...(current.activeNoteId === id ? { activeNoteId: null, reading: false } : {}) });
  }
}
