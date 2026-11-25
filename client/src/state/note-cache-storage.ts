import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { NoteMetaViewSchema, NoteViewSchema } from '../api/shared.ts';
import type { KeyValueStorage } from './outbox.ts';

export const NOTE_CACHE_STORAGE_KEY = 'plasticine:note-cache:v1';
export const NOTE_CACHE_MAX_STORED = 40;
export const NOTE_CACHE_MAX_CHARS = 1_000_000;
export const NOTE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const StoredNoteSchema = Type.Object({ note: NoteViewSchema, cachedAt: Type.Number() });
const StoredListSchema = Type.Object({ notes: Type.Array(NoteMetaViewSchema), cachedAt: Type.Number() });
const StoredSchema = Type.Object({ version: Type.Literal(1), owner: Type.String(),
  notes: Type.Array(StoredNoteSchema), list: Type.Union([StoredListSchema, Type.Null()]) });
export type StoredNote = Static<typeof StoredNoteSchema>;
export type StoredNoteList = Static<typeof StoredListSchema>;

export function clearStoredNotes(storage: KeyValueStorage | null): void {
  try { storage?.removeItem(NOTE_CACHE_STORAGE_KEY); }
  catch (cause) { console.warn('笔记缓存未能清除，当前页面已清空缓存。', cause); }
}

export function restoreNotes(storage: KeyValueStorage | null, owner: string, now: number): {
  notes: StoredNote[]; list: StoredNoteList | null;
} {
  const empty = { notes: [], list: null };
  try {
    const raw = storage?.getItem(NOTE_CACHE_STORAGE_KEY);
    if (raw == null) { return empty; }
    if (raw.length > NOTE_CACHE_MAX_CHARS) {
      clearStoredNotes(storage);
      return empty;
    }
    const value: unknown = JSON.parse(raw);
    if (!Value.Check(StoredSchema, value) || value.owner !== owner) {
      clearStoredNotes(storage);
      return empty;
    }
    const current = (time: number): boolean => time <= now && now - time <= NOTE_CACHE_MAX_AGE_MS;
    return { notes: value.notes.filter((row) => current(row.cachedAt))
      .slice(0, NOTE_CACHE_MAX_STORED),
    list: value.list !== null && current(value.list.cachedAt) ? value.list : null };
  } catch (cause) {
    console.warn('笔记缓存未能恢复，将再读一次正文。', cause);
    clearStoredNotes(storage);
    return empty;
  }
}

export function persistNotes(storage: KeyValueStorage | null, owner: string, notes: readonly StoredNote[],
  list: StoredNoteList | null): void {
  if (storage === null) { return; }
  const rows = notes.slice(0, NOTE_CACHE_MAX_STORED);
  let safeList = list;
  const encode = (): string => JSON.stringify({ version: 1, owner, notes: rows, list: safeList });
  let payload = encode();
  if (safeList !== null && JSON.stringify(safeList).length > NOTE_CACHE_MAX_CHARS / 2) {
    safeList = null;
    payload = encode();
  }
  while (payload.length > NOTE_CACHE_MAX_CHARS && rows.length > 0) {
    rows.pop();
    payload = encode();
  }
  try { storage.setItem(NOTE_CACHE_STORAGE_KEY, payload); }
  catch (cause) { console.warn('笔记缓存未能写入本机，当前编辑和保存继续使用内存。', cause); }
}
