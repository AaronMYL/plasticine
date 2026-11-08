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
  /** 手机上：在某个文件夹的列表里（true），还是在首层的文件夹卡 + 最近（不在列表里）。 */
  phoneList: Type.Optional(Type.Boolean()),
  recentNotes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), title: Type.String(),
    openedAt: Type.String() }))),
});
/**
 * freshNoteId：刚新建、编辑器还没接过焦点的那一篇。只在内存里，不进存档：刷新后再聚焦没有意义；
 * 新建到编辑器挂上之间路由会变、整棵视图会重挂，所以不能放在组件里（用户视角审查 2026-11-01 第 3 条）。
 */
export type NotesUiState = Static<typeof NotesUiSchema> & { freshNoteId?: string };
export type NoteCollection = NotesUiState['collection'];
const KEY = 'plasticine:notes-ui';
/**
 * 合并前的原版笔记所在的文件夹（服务端 agent/src/state/note-folders.ts 的 MERGED_NOTE_FOLDER）。2026-11-05 第 11 条
 * 起文件夹里不再列它，原版从合并后那篇的「合并 n 份原版」里看；以前停在这个文件夹的，打开时回到「全部」。
 */
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
  openNote(note: { id: string; title: string; private: boolean }): void {
    const current = this.store.get();
    const recent = current.recentNotes ?? [];
    if (current.activeNoteId === note.id && current.reading === true
      && (note.private ? !recent.some((row) => row.id === note.id)
        : recent[0]?.id === note.id && recent[0].title === (note.title || '未命名'))) return;
    this.set({ activeNoteId: note.id, reading: true,
      recentNotes: note.private ? recent.filter((row) => row.id !== note.id)
        : [{ id: note.id, title: note.title || '未命名', openedAt: new Date().toISOString() },
          ...recent.filter((row) => row.id !== note.id)].slice(0, 3) });
  }
  showList(): void { this.set({ activeNoteId: null, reading: false }); }
  /** 新建成功：记下这一篇，等编辑器挂上来取。 */
  markFresh(id: string): void { this.set({ freshNoteId: id }); }
  /** 编辑器挂上时问一声：是刚新建的这一篇就取走标记（只聚焦一次），不是就不动。 */
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
