import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventListener } from '../../src/state/events-hub.ts';
import { ApiError, unauthorizedError } from '../../src/api/errors.ts';
import { toMeta } from '../../src/api/note-meta.ts';
import { NotesCache, NOTE_CACHE_FRESH_MS, noteListKey } from '../../src/state/notes-cache.ts';
import { NOTE_CACHE_MAX_AGE_MS, NOTE_CACHE_MAX_CHARS, NOTE_CACHE_STORAGE_KEY }
  from '../../src/state/note-cache-storage.ts';
import { memoryStorage } from '../helpers.tsx';
import { noteView } from '../api/http-fixtures.ts';

const caches: NotesCache[] = [];
function cache(storage = memoryStorage(), now: () => number = Date.now): NotesCache {
  const value = new NotesCache(storage, now);
  caches.push(value);
  value.activate('device_1');
  return value;
}
function api() {
  return { get: vi.fn(async (id: string, _signal?: AbortSignal) => noteView({ id })),
    list: vi.fn(async () => [toMeta(noteView())]) };
}
function hub() {
  let listener: EventListener = () => undefined;
  return { on(next: EventListener) {
    listener = next;
    return () => { listener = () => undefined; };
  },
    emit: (event: Parameters<EventListener>[0]) => listener(event) };
}
afterEach(() => {
  for (const value of caches.splice(0)) { value.clear(); }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('note body cache', () => {
  it('concurrent initial body and list fetch does not cancel body when list has same version', async () => {
    const value = cache();
    const reads = api();
    const pending = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(pending.promise);
    value.observeNote(reads, 'note_1');
    const request = value.loadNote(reads, 'note_1');
    await value.loadList(reads, {});
    expect(reads.get).toHaveBeenCalledTimes(1);
    expect(reads.get.mock.calls[0]?.[1]?.aborted).toBe(false);
    pending.resolve(noteView());
    await request;
    expect(value.store.get().get('note_1')?.note?.version).toBe(1);
  });

  it('dedupes in-flight fetch, skips fresh reopen GET, keeps stale body readable during refresh', async () => {
    let now = 1000;
    const value = cache(undefined, () => now);
    const reads = api();
    const pending = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(pending.promise);
    const first = value.loadNote(reads, 'n1');
    const second = value.loadNote(reads, 'n1');
    expect(first).toBe(second);
    expect(reads.get).toHaveBeenCalledTimes(1);
    pending.resolve(noteView({ id: 'n1' }));
    await first;
    const stop = value.observeNote(reads, 'n1');
    stop();
    await value.loadNote(reads, 'n1');
    expect(reads.get).toHaveBeenCalledTimes(1);
    now += NOTE_CACHE_FRESH_MS + 1;
    const fresh = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(fresh.promise);
    const recheck = value.loadNote(reads, 'n1');
    expect(value.store.get().get('n1')?.note?.markdown).toBe('# 计划\n\n第一段');
    expect(value.store.get().get('n1')?.loading).toBe(true);
    fresh.resolve(noteView({ id: 'n1', version: 2, markdown: '新的正文' }));
    await recheck;
    expect(value.store.get().get('n1')?.note?.version).toBe(2);
    expect(reads.get).toHaveBeenCalledTimes(2);
    reads.get.mockResolvedValueOnce(noteView({ id: 'n1', version: 2 }));
    await value.loadNote(reads, 'n1', true);
    expect(reads.get).toHaveBeenCalledTimes(3);
    expect(value.store.get().get('n1')?.note?.version).toBe(2);
  });

  it('stale GET after newer save does not overwrite higher version or resurrect cleared cache', async () => {
    const storage = memoryStorage();
    const value = cache(storage);
    const reads = api();
    const old = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(old.promise);
    const request = value.loadNote(reads, 'n1');
    value.remember(noteView({ id: 'n1', version: 3, markdown: '新保存的文字' }));
    old.resolve(noteView({ id: 'n1', version: 1, markdown: '旧的文字' }));
    await request;
    expect(value.store.get().get('n1')?.note?.markdown).toBe('新保存的文字');
    const late = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(late.promise);
    const after = value.loadNote(reads, 'n1', true);
    value.clear();
    late.resolve(noteView({ id: 'n1', version: 4 }));
    await after;
    expect(value.store.get().size).toBe(0);
    expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('only higher-version event refreshes that note; reconnect revalidates active body', async () => {
    vi.useFakeTimers();
    const value = cache();
    const reads = api();
    const events = hub();
    value.connect(reads, events);
    await value.loadNote(reads, 'a');
    await value.loadNote(reads, 'b');
    value.observeNote(reads, 'a');
    events.emit({ type: 'note.updated', note: toMeta(noteView({ id: 'a' })) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.get).toHaveBeenCalledTimes(2);
    reads.get.mockImplementation(async (id) => noteView({ id, version: id === 'a' ? 2 : 1 }));
    events.emit({ type: 'note.updated', note: toMeta(noteView({ id: 'a', version: 2 })) });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.get).toHaveBeenCalledTimes(3);
    await value.loadNote(reads, 'b');
    expect(reads.get).toHaveBeenCalledTimes(3);
    events.emit({ type: 'resync' });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.get).toHaveBeenCalledTimes(4);
  });

  it('newer version event during load aborts old fetch and ignores uncancelled stale result', async () => {
    vi.useFakeTimers();
    const value = cache();
    const reads = api();
    const events = hub();
    value.connect(reads, events);
    const old = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(noteView({ id: 'n1', version: 2 }));
    value.observeNote(reads, 'n1');
    const signal = reads.get.mock.calls[0]?.[1];
    events.emit({ type: 'note.updated', note: toMeta(noteView({ id: 'n1', version: 2 })) });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    old.resolve(noteView({ id: 'n1', version: 1 }));
    await Promise.resolve();
    expect(value.store.get().get('n1')?.note?.version).toBe(2);
  });

  it('stale v2 save receipt cannot cancel v3 fetch or mark stale GET fresh', async () => {
    vi.useFakeTimers();
    const value = cache();
    const reads = api();
    const events = hub();
    value.connect(reads, events);
    await value.loadNote(reads, 'n1');
    value.observeNote(reads, 'n1');
    const fresh = Promise.withResolvers<ReturnType<typeof noteView>>();
    reads.get.mockReturnValueOnce(fresh.promise);
    events.emit({ type: 'note.updated', note: toMeta(noteView({ id: 'n1', version: 3 })) });
    await vi.advanceTimersByTimeAsync(0);
    const signal = reads.get.mock.calls[1]?.[1];
    value.remember(noteView({ id: 'n1', version: 2, markdown: '迟到的保存回执' }));
    expect(signal?.aborted).toBe(false);
    expect(value.store.get().get('n1')?.expectedVersion).toBe(3);
    reads.get.mockResolvedValueOnce(noteView({ id: 'n1', version: 3, markdown: '最终版本' }));
    fresh.resolve(noteView({ id: 'n1', version: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(value.store.get().get('n1')?.note?.version).toBe(3);
    expect(value.store.get().get('n1')?.note?.markdown).toBe('最终版本');
    expect(reads.get).toHaveBeenCalledTimes(3);
  });

  it('refresh error preserves confirmed body with visible error; delete or 401 clears cache', async () => {
    const value = cache();
    const reads = api();
    await value.loadNote(reads, 'n1');
    reads.get.mockRejectedValueOnce(new Error('断线'));
    await value.loadNote(reads, 'n1', true);
    expect(value.store.get().get('n1')?.note).not.toBeNull();
    expect(value.store.get().get('n1')?.error).toContain('断线');
    reads.get.mockRejectedValueOnce(new ApiError({ kind: 'not_found', code: 'not_found', message: '没有这篇笔记' }));
    await value.loadNote(reads, 'n1', true);
    expect(value.store.get().get('n1')).toMatchObject({ note: null, error: '没有这篇笔记' });
    value.remember(noteView({ id: 'n1' }));
    reads.get.mockRejectedValueOnce(unauthorizedError());
    await value.loadNote(reads, 'n1', true);
    expect(value.store.get().size).toBe(0);
  });
});

describe('note list and persistent cache', () => {
  it('dedupes identical list queries, skips quick remount fetch, isolates distinct queries', async () => {
    let now = 1000;
    const value = cache(undefined, () => now);
    const reads = api();
    const first = value.loadList(reads, { q: '' });
    expect(value.loadList(reads, {})).toBe(first);
    await first;
    const stop = value.observeList(reads, {});
    stop();
    value.observeList(reads, {});
    expect(reads.list).toHaveBeenCalledTimes(1);
    reads.list.mockResolvedValueOnce([toMeta(noteView({ id: 'folder-note', folder: '旅行' }))]);
    await value.loadList(reads, { folder: '旅行' });
    expect(value.lists.get().get(noteListKey({}))?.notes?.[0]?.id).toBe('note_1');
    expect(value.lists.get().get(noteListKey({ folder: '旅行' }))?.notes?.[0]?.id).toBe('folder-note');
    now += NOTE_CACHE_FRESH_MS + 1;
    await value.loadList(reads, {});
    expect(reads.list).toHaveBeenCalledTimes(3);
  });

  it('delete event immediately purges body cache and list row even when away from page', async () => {
    const storage = memoryStorage();
    const value = cache(storage);
    const reads = api();
    const events = hub();
    value.connect(reads, events);
    await value.loadNote(reads, 'note_1');
    await value.loadList(reads, {});
    events.emit({ type: 'note.deleted', noteId: 'note_1' });
    expect(value.store.get().has('note_1')).toBe(false);
    expect(value.lists.get().get(noteListKey({}))?.notes).toEqual([]);
    expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).not.toContain('第一段');
  });

  it('persisted body and full list restore across reload after session check with revalidation', async () => {
    const storage = memoryStorage();
    const first = cache(storage);
    const reads = api();
    await first.loadNote(reads, 'note_1');
    await first.loadList(reads, {});
    const restored = new NotesCache(storage);
    caches.push(restored);
    expect(restored.store.get().size).toBe(0);
    await restored.loadNote(reads, 'note_1');
    expect(reads.get).toHaveBeenCalledTimes(1);
    restored.activate('device_1');
    expect(restored.store.get().get('note_1')?.note?.markdown).toContain('第一段');
    expect(restored.lists.get().get(noteListKey({}))?.notes).toHaveLength(1);
    expect(restored.store.get().get('note_1')?.checkedAt).toBeNull();
    await restored.loadNote(reads, 'note_1');
    expect(reads.get).toHaveBeenCalledTimes(2);
  });

  it('7-day expiry, device change, or logout clears cache; bounded size survives quota errors', async () => {
    const storage = memoryStorage();
    let now = 1000;
    const value = cache(storage, () => now);
    for (let index = 0; index < 50; index += 1) {
      now += 1;
      value.remember(noteView({ id: `n${index}`, markdown: '字'.repeat(30_000) }));
    }
    const raw = storage.getItem(NOTE_CACHE_STORAGE_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(NOTE_CACHE_MAX_CHARS);
    expect(JSON.parse(raw).notes.length).toBeLessThanOrEqual(40);
    now += NOTE_CACHE_MAX_AGE_MS + 1;
    expect(cache(storage, () => now).store.get().size).toBe(0);
    value.clear();
    expect(storage.getItem(NOTE_CACHE_STORAGE_KEY)).toBeNull();
    value.activate('device_1');
    value.remember(noteView());
    expect(cache(storage).store.get().size).toBe(0);
    const other = new NotesCache(storage, () => now);
    caches.push(other);
    other.activate('different_device');
    expect(other.store.get().size).toBe(0);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    value.remember(noteView({ version: 2, markdown: '照常使用' }));
    expect(value.store.get().get('note_1')?.note?.markdown).toBe('照常使用');
    expect(warning).toHaveBeenCalled();
  });
});
