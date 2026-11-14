import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { EventsHub } from '../../../src/api/events-hub.ts';
import { DouyinStore } from '../../../src/views/feed/douyin-store.ts';

describe('收藏清单刷新', () => {
  it('已读超过两百条时分批刷新，保留已展开的列表与顺序', async () => {
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

describe('整理到哪了', () => {
  it('在服务端筛，三个数按全部收藏算；接着读带着同一个筛选', async () => {
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

  it('换筛选时先清掉上一个筛选读出来的，不让旧条目闪一下', async () => {
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
