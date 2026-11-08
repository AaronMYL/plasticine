// 正文与列表的共享读缓存：快照立即可读，过期或收到事件才后台核实；草稿仍由 NoteDrafts 管。
import type { NotesApi } from '../api/client.ts';
import type { EventsHub } from '../api/events-hub.ts';
import { ApiError, errorText } from '../api/errors.ts';
import type { LiveEvent, NoteMetaView, NoteSearch, NoteView } from '../api/types.ts';
import { clearStoredNotes, persistNotes, restoreNotes } from './note-cache-storage.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

/** 短时间来回切换不重复请求；事件立即失效，超过半分钟回到笔记时后台核实。 */
export const NOTE_CACHE_FRESH_MS = 30_000;
const MEMORY_NOTES = 60;
const MEMORY_CHARS = 4_000_000;
const MEMORY_LISTS = 12;
type ReadApi = Pick<NotesApi, 'get' | 'list'>;
type Flight = { controller: AbortController; promise: Promise<void>; versionRetry?: boolean };
export interface CachedNote {
  note: NoteView | null;
  loading: boolean;
  error: string | null;
  checkedAt: number | null;
  cachedAt: number;
  touchedAt: number;
  expectedVersion: number;
}
export interface CachedNoteList {
  notes: NoteMetaView[] | null;
  loading: boolean;
  error: string | null;
  checkedAt: number | null;
  cachedAt: number;
}
export const EMPTY_NOTE: CachedNote = {
  note: null, loading: false, error: null, checkedAt: null, cachedAt: 0, touchedAt: 0,
  expectedVersion: 0,
};
export const EMPTY_NOTE_LIST: CachedNoteList = {
  notes: null, loading: false, error: null, checkedAt: null, cachedAt: 0,
};

export function noteListKey(query: NoteSearch): string {
  return JSON.stringify([query.q?.trim() ?? '', query.folder ?? null,
    query.deletedOnly ?? false, query.includeDeleted ?? false]);
}
const ALL_NOTES = noteListKey({});

export class NotesCache {
  readonly store = new Store<ReadonlyMap<string, CachedNote>>(new Map());
  readonly lists = new Store<ReadonlyMap<string, CachedNoteList>>(new Map());
  private readonly storage: KeyValueStorage | null;
  private readonly now: () => number;
  private owner: string | null = null;
  private readonly reads = new Map<string, Flight>();
  private readonly listReads = new Map<string, Flight>();
  private readonly readers = new Map<string, number>();
  private readonly listReaders = new Map<string, { count: number; query: NoteSearch }>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storage: KeyValueStorage | null = null, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  /** SessionGate 核实会话后调用；没有会话时连磁盘快照也不会交给视图。 */
  activate(owner: string): void {
    if (this.owner === owner) { return; }
    if (this.owner !== null) { this.clear(); }
    this.owner = owner;
    const restored = restoreNotes(this.storage, owner, this.now());
    this.store.set(new Map(restored.notes.map((row) => [row.note.id,
      { ...EMPTY_NOTE, ...row, touchedAt: row.cachedAt }])));
    if (restored.list !== null) {
      this.lists.set(new Map([[ALL_NOTES, { ...EMPTY_NOTE_LIST, ...restored.list }]]));
    }
  }

  clear(): void {
    this.owner = null;
    for (const flight of [...this.reads.values(), ...this.listReads.values()]) { flight.controller.abort(); }
    this.reads.clear();
    this.listReads.clear();
    if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    this.store.set(new Map());
    this.lists.set(new Map());
    clearStoredNotes(this.storage);
  }

  observeNote(api: ReadApi, id: string): () => void {
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
    const value = this.store.get().get(id);
    if (value !== undefined) { this.setNote(id, { ...value, touchedAt: this.now() }); }
    void this.loadNote(api, id);
    return () => {
      const count = (this.readers.get(id) ?? 1) - 1;
      if (count > 0) { this.readers.set(id, count); return; }
      this.readers.delete(id);
      // 私密正文仍不持久缓存；再次进入从已配对会话直接读取，不增加解锁状态。
      if (this.store.get().get(id)?.note?.private) { this.invalidateNote(id, true); }
    };
  }

  observeList(api: ReadApi, query: NoteSearch): () => void {
    const key = noteListKey(query);
    this.listReaders.set(key, { count: (this.listReaders.get(key)?.count ?? 0) + 1, query });
    void this.loadList(api, query);
    return () => {
      const count = (this.listReaders.get(key)?.count ?? 1) - 1;
      if (count > 0) { this.listReaders.set(key, { count, query }); }
      else { this.listReaders.delete(key); }
    };
  }

  loadNote(api: ReadApi, id: string, force = false): Promise<void> {
    if (this.owner === null) { return Promise.resolve(); }
    const pending = this.reads.get(id);
    if (pending !== undefined) { return pending.promise; }
    const value = this.store.get().get(id) ?? EMPTY_NOTE;
    if (!force && value.note !== null && !value.note.private && this.fresh(value.checkedAt)) {
      return Promise.resolve();
    }
    const flight = { controller: new AbortController(), promise: Promise.resolve() };
    this.reads.set(id, flight);
    this.setNote(id, { ...value, loading: true, error: null });
    flight.promise = this.readNote(api, id, flight);
    return flight.promise;
  }

  loadList(api: ReadApi, query: NoteSearch, force = false): Promise<void> {
    if (this.owner === null) { return Promise.resolve(); }
    const key = noteListKey(query);
    const pending = this.listReads.get(key);
    if (pending !== undefined) { return pending.promise; }
    const value = this.lists.get().get(key) ?? EMPTY_NOTE_LIST;
    if (!force && value.notes !== null && this.fresh(value.checkedAt)) { return Promise.resolve(); }
    const flight = { controller: new AbortController(), promise: Promise.resolve() };
    this.listReads.set(key, flight);
    this.setList(key, { ...value, loading: true, error: null });
    flight.promise = this.readList(api, query, key, flight);
    return flight.promise;
  }

  /** 保存/恢复响应已经带完整正文；直接记下该版本，不再为同一版本重拉一遍。 */
  remember(note: NoteView): void {
    if (this.owner === null) { return; }
    const old = this.store.get().get(note.id);
    if (note.version < Math.max(old?.note?.version ?? 0, old?.expectedVersion ?? 0)) { return; }
    this.reads.get(note.id)?.controller.abort();
    this.reads.delete(note.id);
    this.accept(note);
  }

  connect(api: ReadApi, hub: Pick<EventsHub, 'on'>): () => void {
    const stop = hub.on((event) => this.onEvent(api, event));
    return () => {
      stop();
      if (this.refreshTimer !== null) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    };
  }

  private fresh(checkedAt: number | null): boolean {
    return checkedAt !== null && this.now() - checkedAt < NOTE_CACHE_FRESH_MS;
  }

  private accept(note: NoteView): void {
    const old = this.store.get().get(note.id) ?? EMPTY_NOTE;
    if (note.version < Math.max(old.note?.version ?? 0, old.expectedVersion)) {
      this.setNote(note.id, { ...old, loading: false });
      return;
    }
    if (note.private && !this.readers.has(note.id)) { this.invalidateNote(note.id, true); return; }
    const confirmed = old.note?.version === note.version ? old.note : note;
    const now = this.now();
    this.setNote(note.id, { note: confirmed, checkedAt: now, cachedAt: now, touchedAt: now,
      loading: false, error: null, expectedVersion: note.version });
    this.trim();
    this.persist();
  }

  private async readNote(api: ReadApi, id: string, flight: Flight): Promise<void> {
    try {
      const note = await api.get(id, flight.controller.signal);
      if (flight.controller.signal.aborted || this.reads.get(id) !== flight || this.owner === null) { return; }
      if (note.id !== id) { throw new Error('读到的笔记标识不匹配，请重试。'); }
      const expected = this.store.get().get(id)?.expectedVersion ?? 0;
      if (note.version < expected) {
        if (flight.versionRetry) { throw new Error('笔记版本正在同步，请稍后重试。'); }
        const next: Flight = { controller: new AbortController(), promise: Promise.resolve(), versionRetry: true };
        this.reads.set(id, next);
        next.promise = this.readNote(api, id, next);
        await next.promise;
        return;
      }
      this.accept(note);
    } catch (cause) {
      if (flight.controller.signal.aborted || this.reads.get(id) !== flight || this.owner === null) { return; }
      if (cause instanceof ApiError && cause.kind === 'unauthorized') { this.clear(); return; }
      const old = this.store.get().get(id) ?? EMPTY_NOTE;
      const gone = cause instanceof ApiError && cause.kind === 'not_found';
      const denied = cause instanceof ApiError && cause.status === 403;
      this.setNote(id, { ...old, note: gone || denied ? null : old.note, loading: false,
        checkedAt: null, error: errorText(cause) });
      this.persist();
    } finally {
      if (this.reads.get(id) === flight) { this.reads.delete(id); }
    }
  }

  private async readList(api: ReadApi, query: NoteSearch, key: string, flight: Flight): Promise<void> {
    try {
      const notes = await api.list(query, flight.controller.signal);
      if (flight.controller.signal.aborted || this.listReads.get(key) !== flight || this.owner === null) { return; }
      this.setList(key, { notes, loading: false, error: null, checkedAt: this.now(), cachedAt: this.now() });
      for (const note of notes) { this.observeVersion(note, true); }
      if (key === ALL_NOTES) {
        const ids = new Set(notes.map((note) => note.id));
        for (const [id, value] of this.store.get()) {
          if (value.note?.deletedAt === null && !ids.has(id)) { this.invalidateNote(id); }
        }
      }
      this.trim();
      this.persist();
      this.refreshActive(api);
    } catch (cause) {
      if (flight.controller.signal.aborted || this.listReads.get(key) !== flight || this.owner === null) { return; }
      if (cause instanceof ApiError && cause.kind === 'unauthorized') { this.clear(); return; }
      const old = this.lists.get().get(key) ?? EMPTY_NOTE_LIST;
      this.setList(key, { ...old, loading: false, checkedAt: null, error: errorText(cause) });
    } finally {
      if (this.listReads.get(key) === flight) { this.listReads.delete(key); }
    }
  }

  private observeVersion(note: NoteMetaView, fromList = false): void {
    const value = this.store.get().get(note.id);
    if (value === undefined) { return; }
    if (note.private && value.note !== null && !value.note.private) { this.invalidateNote(note.id, true); }
    else if (note.version > Math.max(value.note?.version ?? 0, value.expectedVersion)) {
      if (fromList && value.note === null && value.loading) {
        this.setNote(note.id, { ...value, expectedVersion: note.version });
        return;
      }
      this.invalidateNote(note.id, false, note.version);
    }
  }

  private onEvent(api: ReadApi, event: LiveEvent): void {
    if (this.owner === null) { return; }
    if (event.type === 'note.updated') { this.observeVersion(event.note); }
    else if (event.type === 'note.deleted') { this.invalidateNote(event.noteId, true); }
    else if (event.type === 'note.invalidated' && event.noteId !== 'folders') {
      this.invalidateNote(event.noteId);
    } else if (event.type === 'resync' || event.type === 'note.invalidated') {
      for (const id of this.store.get().keys()) { this.invalidateNote(id); }
    } else { return; }
    for (const [key, value] of this.lists.get()) {
      this.listReads.get(key)?.controller.abort();
      this.listReads.delete(key);
      const notes = event.type === 'note.deleted'
        ? value.notes?.filter((note) => note.id !== event.noteId) ?? null : value.notes;
      this.setList(key, { ...value, notes, checkedAt: null, loading: false });
    }
    this.persist();
    // 合并同一事件批次；保存响应可在此之前填入完整新版本，避免自己保存后重复 GET。
    if (this.refreshTimer !== null) { return; }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshActive(api);
      for (const { query } of this.listReaders.values()) { void this.loadList(api, query); }
    }, 0);
  }

  private refreshActive(api: ReadApi): void {
    for (const id of this.readers.keys()) {
      const value = this.store.get().get(id);
      if (value === undefined || !this.fresh(value.checkedAt) && value.error === null) {
        void this.loadNote(api, id);
      }
    }
  }

  private invalidateNote(id: string, discard = false, version?: number): void {
    this.reads.get(id)?.controller.abort();
    this.reads.delete(id);
    const value = this.store.get().get(id);
    if (value === undefined) { return; }
    if (discard) {
      const next = new Map(this.store.get());
      next.delete(id);
      this.store.set(next);
    } else {
      this.setNote(id, { ...value, checkedAt: null, loading: false, error: null,
        expectedVersion: version ?? value.expectedVersion });
    }
  }

  private setNote(id: string, value: CachedNote): void {
    const next = new Map(this.store.get());
    next.set(id, value);
    this.store.set(next);
  }

  private setList(key: string, value: CachedNoteList): void {
    const next = new Map(this.lists.get());
    next.set(key, value);
    this.lists.set(next);
  }

  private trim(): void {
    const notes = new Map(this.store.get());
    let size = [...notes.values()].reduce((sum, value) => sum + (value.note?.markdown.length ?? 0), 0);
    for (const [id, value] of [...notes].sort((a, b) => a[1].touchedAt - b[1].touchedAt)) {
      if (notes.size <= MEMORY_NOTES && size <= MEMORY_CHARS) { break; }
      if (this.readers.has(id)) { continue; }
      notes.delete(id);
      size -= value.note?.markdown.length ?? 0;
    }
    if (notes.size !== this.store.get().size) { this.store.set(notes); }
    const lists = new Map(this.lists.get());
    for (const key of lists.keys()) {
      if (lists.size <= MEMORY_LISTS) { break; }
      if (!this.listReaders.has(key)) { lists.delete(key); }
    }
    if (lists.size !== this.lists.get().size) { this.lists.set(lists); }
  }

  private persist(): void {
    if (this.owner === null) { return; }
    const notes = [...this.store.get().values()].sort((a, b) => b.touchedAt - a.touchedAt)
      .flatMap((row) => row.note === null ? [] : [{ note: row.note, cachedAt: row.cachedAt }]);
    const all = this.lists.get().get(ALL_NOTES);
    const list = all?.notes == null ? null : { notes: all.notes, cachedAt: all.cachedAt };
    persistNotes(this.storage, this.owner, notes, list);
  }
}
