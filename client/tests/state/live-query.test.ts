import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../../src/api/types.ts';
import { LiveQueries, WARM_MS, type EventSource } from '../../src/state/live-query.ts';

function fakeHub(): EventSource & { emit: (event: LiveEvent) => void } {
  const listeners = new Set<(event: LiveEvent) => void>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

const TASKS = new Set<LiveEvent['type']>(['tasks.changed']);

describe('LiveQueries', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('revisiting cached page serves in-memory snapshot without refetching', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    const fetch = vi.fn(async () => ({ rows: [1] }));
    queries.register('tasks', fetch, TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    expect(queries.get('tasks')).toEqual({ data: { rows: [1] }, error: null, loading: false });
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('relevant event triggers background refetch even when user is on another page', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    let value = 1;
    const fetch = vi.fn(async () => ({ value }));
    queries.register('tasks', fetch, TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    value = 2;
    hub.emit({ type: 'tasks.changed' });
    hub.emit({ type: 'tasks.changed' });
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queries.get('tasks')?.data).toEqual({ value: 2 });
  });

  it('unrelated events do not trigger refetch', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    const fetch = vi.fn(async () => 1);
    queries.register('tasks', fetch, TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    hub.emit({ type: 'calendar.changed' });
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('identical refetch payload keeps snapshot reference and skips notifying subscribers', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    queries.register('tasks', async () => ({ rows: [1, 2] }), TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    const first = queries.get('tasks');
    const listener = vi.fn();
    queries.subscribe('tasks', listener);
    hub.emit({ type: 'tasks.changed' });
    await vi.runAllTimersAsync();
    expect(listener).not.toHaveBeenCalled();
    expect(queries.get('tasks')).toBe(first);
  });

  it('stale unused snapshot only marks dirty on event and refetches when reopened', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    const fetch = vi.fn(async () => 1);
    queries.register('tasks', fetch, TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    now += WARM_MS + 1;
    hub.emit({ type: 'tasks.changed' });
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resync event refetches all snapshots', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');
    queries.register('a', a, TASKS);
    queries.register('b', b, new Set());
    queries.ensure('a');
    queries.ensure('b');
    await vi.runAllTimersAsync();
    hub.emit({ type: 'resync' } as LiveEvent);
    await vi.runAllTimersAsync();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('failed refetch preserves existing snapshot and reports error reason', async () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    let fail = false;
    queries.register('tasks', async () => {
      if (fail) throw new Error('断网了');
      return 1;
    }, TASKS);
    queries.ensure('tasks');
    await vi.runAllTimersAsync();
    fail = true;
    queries.reload('tasks');
    await vi.runAllTimersAsync();
    expect(queries.get('tasks')).toMatchObject({ data: 1, loading: false });
    expect(queries.get('tasks')?.error).toContain('断网了');
  });

  it('initial in-flight load reports loading state with no data', () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    queries.register('tasks', () => new Promise(() => {}), TASKS);
    queries.ensure('tasks');
    expect(queries.get('tasks')).toEqual({ data: null, error: null, loading: true });
  });
});

describe('invalidateQueries', () => {
  it('local library mutation marks matching snapshots dirty and refetches recently used ones', async () => {
    vi.useFakeTimers();
    const { invalidateQueries } = await import('../../src/state/live-query.ts');
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { delayMs: 10 });
    const spaces = vi.fn(async () => 1);
    const notes = vi.fn(async () => 1);
    queries.register('spaces.list', spaces, new Set());
    queries.register('notes.list', notes, new Set());
    queries.ensure('spaces.list');
    queries.ensure('notes.list');
    await vi.runAllTimersAsync();
    invalidateQueries((key) => key.startsWith('spaces.'));
    await vi.runAllTimersAsync();
    expect(spaces).toHaveBeenCalledTimes(2);
    expect(notes).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
