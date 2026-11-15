// 假接口的每日设置、信息流照真服务端的规矩做：按 requestId 幂等、过时的 version 回 409；
// 信息流不感兴趣的默认不在列表里。

import { describe, expect, it } from 'vitest';
import { ApiError, ConflictError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import type { LiveEvent } from '../../src/api/types.ts';
import { NOW } from '../helpers.tsx';

/** 等它被拒，拿回那个错误。 */
function refused(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  const events: LiveEvent[] = [];
  fake.api.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
  return { ...fake, events };
}

it('第 94 条：预置与手动信息流都使用自己的来源，不再产生阅读标签', async () => {
  const fake = createFakeApi({ seed: true, streamStepMs: 0, now: () => NOW });
  const sources = await fake.api.feed.sources();
  // 第 3 批：其他来源里是站内的（手动添加、按关注点搜新闻）、订阅和 X；第 7 批加了 Reddit 版块。没有阅读。
  expect(sources.others.every((source) => ['internal', 'rss', 'x', 'reddit'].includes(source.kind))).toBe(true);
  expect(JSON.stringify(sources)).not.toContain('阅读');
  const items = await fake.api.feed.list({});
  expect(items.items.some((item) => item.originLabel === '阅读')).toBe(false);
  const item = await fake.api.feed.add({ requestId: 'req_no_reading', title: '手动条目' }, 'UTC');
  expect(item.origin).toBe('manual');
  expect(item.originLabel).toBe('手动添加');
});

describe('假接口 · 每日设置', () => {
  it('带过时的 version 是 409；存上后版本加一', async () => {
    const { api } = setup();
    const stale = await refused(api.today.saveSettings({ requestId: 'req_set_00001', version: 3, briefLimit: 2 }));
    expect(stale).toMatchObject({ kind: 'conflict', status: 409 });
    const saved = await api.today.saveSettings({ requestId: 'req_set_00002', version: 0, briefLimit: 2 });
    expect(saved).toMatchObject({ briefLimit: 2, version: 1 });
  });
});

describe('假接口 · 信息流', () => {
  it('列表和今天新增都按抵达时刻与请求时区算，不按入库时记的日期', async () => {
    const { api, control } = setup();
    control.feed.seedItem({ id: 'a', title: '跨日条目', day: '2026-10-27', arrivedAt: NOW.toISOString() });
    const chicago = await api.feed.list({ day: '2026-10-26', tz: 'America/Chicago' });
    expect(chicago.items.map((item) => item.id)).toEqual(['a']);
    expect(chicago.newToday).toBe(1);
    const shanghai = await api.feed.list({ day: '2026-10-27', tz: 'Asia/Shanghai' });
    expect(shanghai.items.map((item) => item.id)).toEqual(['a']);
    expect(shanghai.newToday).toBe(1);
    expect((await api.feed.list({ day: '2026-10-27', tz: 'America/Chicago' })).items).toEqual([]);
  });

  it('夏令时切换日按当地日期筛，午夜边界不漏不多', async () => {
    const { api, control } = setup();
    const seeds = [
      { id: 'before', arrivedAt: '2026-11-01T03:59:59.000Z' },
      { id: 'start', arrivedAt: '2026-11-01T04:00:00.000Z' },
      { id: 'last', arrivedAt: '2026-11-02T04:59:59.000Z' },
      { id: 'after', arrivedAt: '2026-11-02T05:00:00.000Z' },
    ];
    for (const seed of seeds) {
      control.feed.seedItem({ ...seed, title: seed.id, day: '2026-11-01' });
    }
    const list = await api.feed.list({ day: '2026-11-01', tz: 'America/New_York' });
    expect(list.items.map((item) => item.id)).toEqual(['last', 'start']);
  });

  it('新的在前；不感兴趣的默认不在里面，includeHidden 才有；赞过的版本加一并推 feed.changed', async () => {
    const { api, control, events } = setup();
    control.feed.seedItem({ id: 'old', title: '旧', arrivedAt: '2026-10-27T00:00:00.000Z' });
    control.feed.seedItem({ id: 'new', title: '新', arrivedAt: '2026-10-27T01:00:00.000Z' });
    control.feed.seedItem({ id: 'no', title: '不要', reaction: 'dislike' });
    expect((await api.feed.list({})).items.map((item) => item.id)).toEqual(['new', 'old']);
    expect((await api.feed.list({ includeHidden: true })).items.map((item) => item.id)).toContain('no');
    const liked = await api.feed.react('old', { requestId: 'req_like_0001', version: 1, reaction: 'like' });
    expect(liked).toMatchObject({ reaction: 'like', version: 2 });
    expect(events.some((event) => event.type === 'feed.changed' && event.item.id === 'old')).toBe(true);
  });

  it('手动加的链接要是 http(s)：别的 400；加上的标「手动添加」', async () => {
    const { api } = setup();
    const bad = await refused(api.feed.add({ requestId: 'req_add_00001', title: 'x', url: 'not a url' }, 'UTC'));
    expect(bad).toMatchObject({ status: 400, field: 'url' });
    const item = await api.feed.add({ requestId: 'req_add_00002', title: '一篇', url: 'https://a.example/x' }, 'UTC');
    expect(item).toMatchObject({ origin: 'manual', originLabel: '手动添加', site: 'a.example' });
  });
});
