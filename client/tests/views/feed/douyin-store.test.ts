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
