import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { EventsHub } from '../../../src/state/events-hub.ts';
import { DouyinStore } from '../../../src/views/feed/douyin-store.ts';

describe('favorites list refresh', () => {
  it('refreshes >200 loaded items in batches preserving expanded list and order', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    fake.control.session.signInForDevelopment('测试机');
    const fetch = fake.api.feed.douyin.bind(fake.api.feed);
    const calls = vi.spyOn(fake.api.feed, 'douyin').mockImplementation((query, signal) => {
      if ((query.limit ?? 0) > 200) throw new Error('超过接口单页上限');
      return fetch(query, signal);
    });
    const store = new DouyinStore(fake.api, new EventsHub(fake.api.events));
    await store.load(true);
    for (let page = 0; page < 4; page += 1) await store.more();
    const ids = store.state.get().works.map((work) => work.id);
    expect(ids).toHaveLength(250);
    calls.mockClear();
    await store.load(false);
    expect(store.state.get().error).toBeNull();
    expect(store.state.get().works.map((work) => work.id)).toEqual(ids);
    expect(calls.mock.calls.map(([query]) => [query.limit, query.offset])).toEqual([[200, 0], [50, 200]]);
  });
});

describe('organize status filter', () => {
  it('filters server-side with full-collection counts and preserves filter across pagination', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    fake.control.session.signInForDevelopment('测试机');
    const calls = vi.spyOn(fake.api.feed, 'douyin');
    const store = new DouyinStore(fake.api, new EventsHub(fake.api.events));
    await store.load(true);
    expect(store.state.get().data?.counts).toEqual({ all: 1434, todo: 1431, done: 3 });
    await store.setPhase('done');
    const done = store.state.get().works;
    expect(done).toHaveLength(3);
    expect(done.every((work) => work.stage === 'summarized')).toBe(true);
    expect(calls.mock.lastCall?.[0]).toMatchObject({ phase: 'done', offset: 0 });
    expect(store.state.get().data?.counts).toEqual({ all: 1434, todo: 1431, done: 3 });
    await store.setPhase('todo');
    await store.more();
    expect(calls.mock.lastCall?.[0]).toMatchObject({ phase: 'todo', offset: 50 });
    expect(store.state.get().works.some((work) => work.stage === 'summarized')).toBe(false);
    await store.setPhase(null);
    expect(calls.mock.lastCall?.[0]).not.toHaveProperty('phase');
  });

  it('switching filter clears prior list immediately to prevent stale item flash', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    fake.control.session.signInForDevelopment('测试机');
    const store = new DouyinStore(fake.api, new EventsHub(fake.api.events));
    await store.load(true);
    const pending = store.setPhase('done');
    expect(store.state.get().works).toEqual([]);
    expect(store.state.get().status).toBe('loading');
    await pending;
    expect(store.state.get().works).toHaveLength(3);
  });
});
