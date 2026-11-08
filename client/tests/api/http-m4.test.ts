// 每日设置、信息流的真实现：路径、请求体照 shared；409 带 current 的换成 ConflictError；加链接的时区在查询参数里；
// 回答不合 schema 的写操作算「结果待核实」。事件流认信息流条目的事件。

import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { FeedItemView, LiveEvent } from '../../src/api/types.ts';
import { NOW } from '../helpers.tsx';
import { eventSources, fakeFetch, json } from './http-fixtures.ts';

/** 合 schema 的一条：从假实现里拿，形状和真服务端一样。 */
async function views(): Promise<{ item: FeedItemView }> {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  return { item: fake.control.feed.seedItem({ id: 'f1', title: '一篇' }) };
}

describe('真接口 · 今日', () => {
  it('每日设置：PUT /v2/today/settings', async () => {
    const settings = { briefLimit: 5, returnThresholdHours: 4, interviewEnabled: true, interviewPerDay: 3, version: 1 };
    const { fetch, calls } = fakeFetch(() => json(200, settings));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    expect(await http.today.saveSettings({ requestId: 'req_00000005', version: 0, briefLimit: 5 })).toEqual(settings);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/v2/today/settings' });
  });
});

describe('真接口 · 信息流', () => {
  it('加一条链接：POST /v2/feed/items?tz=，请求体照 shared', async () => {
    const { item } = await views();
    const { fetch, calls } = fakeFetch(() => json(201, { item }));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    await http.feed.add({ requestId: 'req_00000006', title: '一篇', url: 'https://a.example' }, 'Asia/Shanghai');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/feed/items?tz=Asia%2FShanghai' });
    expect(calls[0]?.body).toEqual({ requestId: 'req_00000006', title: '一篇', url: 'https://a.example' });
  });

  it('列表带 includeHidden；反应 409 带 current 是 ConflictError', async () => {
    const { item } = await views();
    const { fetch, calls } = fakeFetch(
      () => json(200, { items: [item], nextOffset: null, newToday: 1 }),
      () => json(409, { error: '这一条在别处改过了，这次没有改。', code: 'version_conflict', current: { ...item, version: 2 } }),
    );
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    await http.feed.list({ includeHidden: true, offset: 0 });
    expect(calls[0]?.url).toBe('/v2/feed?includeHidden=true&offset=0');
    const failure = await http.feed
      .react('f1', { requestId: 'req_00000007', version: 1, reaction: 'like' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/v2/feed/items/f1/reaction' });
  });
});

describe('真事件流 · M4', () => {
  it('信息流条目的事件整行带过来', async () => {
    const { item } = await views();
    const sources = eventSources();
    const http = createHttpApi({ fetch: fakeFetch(() => json(200, {})).fetch, createEventSource: sources.create });
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    sources.created[0]?.emit('feed_item_changed', { type: 'feed_item_changed', item });
    expect(events.map((event) => event.type)).toEqual(['feed.changed']);
  });

  it('M4 事件不合 schema：不猜，当作补不上了', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sources = eventSources();
    const http = createHttpApi({ fetch: fakeFetch(() => json(200, {})).fetch, createEventSource: sources.create });
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    sources.created[0]?.emit('feed_item_changed', { type: 'feed_item_changed', item: { id: 'x' } });
    expect(events).toEqual([{ type: 'resync' }]);
  });
});
