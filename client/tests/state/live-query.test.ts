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

  it('回到读过的页面直接给手里那份，不再读', async () => {
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

  it('相关事件一到就在后台重读，人不在页面上也读', async () => {
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

  it('不相关的事件不重读', async () => {
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

  it('读回来和手里一样就不换，订阅的人不会被叫', async () => {
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

  it('很久没用的份，事件来了只标旧；再打开时才读', async () => {
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

  it('事件流补不上（resync）时所有份都重读', async () => {
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

  it('读失败时手里那份留着，写一句原因', async () => {
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

  it('第一次读还没回来时是 loading，手里没有数据', () => {
    const hub = fakeHub();
    const queries = new LiveQueries(hub, { now: () => now, delayMs: 10 });
    queries.register('tasks', () => new Promise(() => {}), TASKS);
    queries.ensure('tasks');
    expect(queries.get('tasks')).toEqual({ data: null, error: null, loading: true });
  });
});

describe('invalidateQueries', () => {
  it('本机改了资料库：匹配的份标旧，最近用过的在后台重读', async () => {
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
