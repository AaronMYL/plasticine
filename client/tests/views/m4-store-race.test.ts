// 拉快照期间到的新事件不被旧快照盖掉（审查 M2 的 P1，照 task-store 的合并做法）：关切板、首页（原今日）、信息流各一条。
// 做法：下一次拉取先拍好快照、等放行才回来；放行之前另一台设备改了那一条（推事件）；换上快照后还是新的那一版。

import { describe, expect, it, vi } from 'vitest';
import { EventsHub } from '../../src/api/events-hub.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { FeedUi } from '../../src/state/feed-ui.ts';
import { FeedStore } from '../../src/views/feed/feed-store.ts';
import { NOW } from '../helpers.tsx';
import { COGNITION_PAGE_DEFAULT } from '../../src/api/shared.ts';
import { waitFor } from '@testing-library/react';

async function drain(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 一道闸：拉取先拍好快照，等 release() 放行才回来。 */
function held(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  const hub = new EventsHub(fake.api.events);
  return { fake, hub };
}

describe('M4 · 拉取期间到的新事件不被旧快照盖掉', () => {
  it('不感兴趣移走一条后再翻页，分页边界上的下一条不会漏', async () => {
    const { fake, hub } = setup();
    for (let i = 0; i < COGNITION_PAGE_DEFAULT + 2; i += 1) {
      fake.control.feed.seedItem({ id: `f${String(i).padStart(3, '0')}`, title: `文章 ${i}` });
    }
    const store = new FeedStore(fake.api, hub, new FeedUi());
    await store.reload();
    store.applyItem(await fake.api.feed.react('f000', { requestId: 'hide', version: 1, reaction: 'dislike' }));
    await store.more();
    const ids = store.data.get().items.map((item) => item.id);
    expect(ids).toHaveLength(COGNITION_PAGE_DEFAULT + 1);
    expect(ids).toContain(`f${String(COGNITION_PAGE_DEFAULT).padStart(3, '0')}`);
    expect(ids).not.toContain('f000');
    store.stop();
  });

  it('翻页还没回来时切换是否显示不感兴趣，过期页不能追加或改变新分页位置', async () => {
    const { fake, hub } = setup();
    for (let i = 0; i < COGNITION_PAGE_DEFAULT + 3; i += 1) {
      fake.control.feed.seedItem({ id: `f${String(i).padStart(3, '0')}`, title: `文章 ${i}` });
    }
    fake.control.feed.seedItem({ id: 'hidden', title: '藏着的', reaction: 'dislike' });
    const store = new FeedStore(fake.api, hub, new FeedUi());
    await store.reload();
    const gate = held();
    const list = fake.api.feed.list.bind(fake.api.feed);
    vi.spyOn(fake.api.feed, 'list').mockImplementationOnce(async (query) => {
      const snapshot = await list(query);
      await gate.wait;
      return snapshot;
    });
    const paging = store.more();
    await drain();
    await store.setIncludeHidden(true);
    gate.release();
    await paging;
    expect(store.data.get().items).toHaveLength(COGNITION_PAGE_DEFAULT);
    expect(store.data.get().nextOffset).toBe(COGNITION_PAGE_DEFAULT);
    await store.more();
    expect(store.item('hidden')).toBeDefined();
    store.stop();
  });

  it('分页位置正在重建时不能用旧位置翻页，重建失败后也不继续旧分页', async () => {
    const { fake, hub } = setup();
    for (let i = 0; i < COGNITION_PAGE_DEFAULT + 2; i += 1) {
      fake.control.feed.seedItem({ id: `f${i}`, title: `文章 ${i}` });
    }
    const store = new FeedStore(fake.api, hub, new FeedUi());
    await store.reload();
    const gate = held();
    const list = fake.api.feed.list.bind(fake.api.feed);
    const request = vi.spyOn(fake.api.feed, 'list').mockImplementationOnce(async (query) => {
      const snapshot = await list(query);
      await gate.wait;
      return snapshot;
    });
    const loading = store.setIncludeHidden(true);
    await store.more();
    expect(request.mock.calls.some(([query]) => (query.offset ?? 0) > 0)).toBe(false);
    gate.release();
    await loading;
    vi.spyOn(fake.api.feed, 'list').mockRejectedValueOnce(new Error('重建失败'));
    await store.reload();
    await store.more();
    expect(store.data.get().items).toHaveLength(COGNITION_PAGE_DEFAULT);
    store.stop();
  });

  it('再次进入信息流会静默刷新来源档位，读取期间保留当前来源', async () => {
    const { fake, hub } = setup();
    fake.control.feed.seedSource({ id: 'source', kind: 'interest', label: '关心的事' });
    const store = new FeedStore(fake.api, hub, new FeedUi());
    store.open();
    await drain();
    await fake.api.feed.setSourceLevel('source', { requestId: 'level', version: 1, level: 'more' });
    const gate = held();
    const sources = fake.api.feed.sources.bind(fake.api.feed);
    vi.spyOn(fake.api.feed, 'sources').mockImplementationOnce(async () => {
      await gate.wait;
      return sources();
    });
    store.open();
    expect(store.sources.get().status).toBe('ready');
    expect(store.sources.get().sources?.interests[0]?.level).toBe('normal');
    gate.release();
    await waitFor(() => expect(store.sources.get().sources?.interests[0]?.level).toBe('more'));
    store.stop();
  });

  it('信息流：拉的时候另一台设备赞了这一条，旧快照回来后它还是已赞', async () => {
    const { fake, hub } = setup();
    fake.control.feed.seedItem({ id: 'f1', title: '一篇文章' });
    const store = new FeedStore(fake.api, hub, new FeedUi());
    store.start();
    hub.start();
    const { wait, release } = held();
    const list = fake.api.feed.list.bind(fake.api.feed);
    vi.spyOn(fake.api.feed, 'list').mockImplementationOnce(async (query) => {
      const snapshot = await list(query);
      await wait;
      return snapshot;
    });
    store.open();
    await drain();
    await fake.api.feed.react('f1', { requestId: 'req_elsewhere_2', version: 1, reaction: 'like' });
    release();
    await drain();
    expect(store.item('f1')?.reaction).toBe('like');
    store.stop();
    hub.stop();
  });
});
