import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import type { LiveEvent } from '../../src/api/types.ts';
import { NOW } from '../helpers.tsx';

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

it('Preset and manual feeds use their own sources without generating reading tags', async () => {
  const fake = createFakeApi({ seed: true, streamStepMs: 0, now: () => NOW });
  const sources = await fake.api.feed.sources();
  expect(sources.others.every((source) => ['internal', 'rss', 'x', 'reddit'].includes(source.kind))).toBe(true);
  expect(JSON.stringify(sources)).not.toContain('阅读');
  const items = await fake.api.feed.list({});
  expect(items.items.some((item) => item.originLabel === '阅读')).toBe(false);
  const item = await fake.api.feed.add({ requestId: 'req_no_reading', title: '手动条目' }, 'UTC');
  expect(item.origin).toBe('manual');
  expect(item.originLabel).toBe('手动添加');
});

describe('Mock API - daily settings', () => {
  it('Stale version returns 409; successful save increments version', async () => {
    const { api } = setup();
    const stale = await refused(api.today.saveSettings({ requestId: 'req_set_00001', version: 3, briefLimit: 2 }));
    expect(stale).toMatchObject({ kind: 'conflict', status: 409 });
    const saved = await api.today.saveSettings({ requestId: 'req_set_00002', version: 0, briefLimit: 2 });
    expect(saved).toMatchObject({ briefLimit: 2, version: 1 });
  });
});

describe('Mock API - feed', () => {
  it('List and today-new count by arrival time and request timezone, not stored date', async () => {
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

  it('Filters by local date on DST transition day without missing or extra items', async () => {
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

  it('Newest first, hides dismissed unless includeHidden; like bumps version and emits', async () => {
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

  it('Manual link requires http(s), returns 400 otherwise, tags as manually added', async () => {
    const { api } = setup();
    const bad = await refused(api.feed.add({ requestId: 'req_add_00001', title: 'x', url: 'not a url' }, 'UTC'));
    expect(bad).toMatchObject({ status: 400, field: 'url' });
    const item = await api.feed.add({ requestId: 'req_add_00002', title: '一篇', url: 'https://a.example/x' }, 'UTC');
    expect(item).toMatchObject({ origin: 'manual', originLabel: '手动添加', site: 'a.example' });
  });
});
