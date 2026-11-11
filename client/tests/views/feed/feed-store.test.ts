import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventsHub } from '../../../src/api/events-hub.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { COGNITION_PAGE_DEFAULT } from '../../../src/api/shared.ts';
import { FeedUi } from '../../../src/state/feed-ui.ts';
import { FeedStore } from '../../../src/views/feed/feed-store.ts';
import { NOW } from '../../helpers.tsx';

function setup() {
  const fake = createFakeApi({ seed: false, now: () => NOW, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const source = fake.control.feed.seedSource({ id: 'source', kind: 'interest', label: '关注点' });
  const store = new FeedStore(fake.api, new EventsHub(fake.api.events), new FeedUi());
  return { fake, source, store };
}

describe('信息流来源的请求生命周期', () => {
  it('迟到的评论列表和原POST回放不覆盖已完成回复，也不移除新评论', () => {
    const { store } = setup();
    const pending = { id: 'reply', itemId: 'item', author: 'ai' as const, text: '',
      createdAt: NOW.toISOString(), replyTo: 'user', status: 'pending' as const,
      error: null, migrated: false, version: 1 };
    const completed = { ...pending, text: '完整回复', status: 'completed' as const, version: 2 };
    const next = { ...pending, id: 'next', author: 'user' as const, text: '后补的一句',
      status: 'completed' as const, replyTo: null };
    store.applyComments('item', { comments: [completed, next] });
    store.applyComments('item', { comments: [pending] });
    store.applyComments('item', { comments: [] });
    expect(store.comments.get().get('item')).toEqual([completed, next]);
    store.stop();
  });

  it('首次来源请求未完成就停止，重新开始并打开后可以读到来源，旧响应不覆盖', async () => {
    const { fake, store } = setup();
    const snapshot = await fake.api.feed.sources();
    const gate = Promise.withResolvers<typeof snapshot>();
    vi.spyOn(fake.api.feed, 'sources').mockReturnValueOnce(gate.promise);
    store.start();
    store.open();
    expect(store.sources.get().status).toBe('loading');
    store.stop();
    fake.control.feed.seedSource({ id: 'source', kind: 'interest', label: '新名称', version: 2 });
    store.start();
    store.open();
    try {
      await waitFor(() => expect(store.sources.get().status).toBe('ready'));
      gate.resolve(snapshot);
      await gate.promise;
      expect(store.sources.get().sources?.interests[0]?.label).toBe('新名称');
    } finally {
      gate.resolve(snapshot);
      store.stop();
    }
  });

  it.each([false, true])('来源请求期间类别改变，按最新版重新分组（已有快照：%s）', async (loaded) => {
    const { fake, source, store } = setup();
    if (loaded) {
      await store.loadSources();
    }
    const snapshot = await fake.api.feed.sources();
    const gate = Promise.withResolvers<typeof snapshot>();
    vi.spyOn(fake.api.feed, 'sources').mockReturnValueOnce(gate.promise);
    const loading = store.loadSources();
    store.applySource({ ...source, kind: 'blocked_site', version: 2 });
    gate.resolve(snapshot);
    await loading;
    expect(store.sources.get().sources?.interests).toEqual([]);
    expect(store.sources.get().sources?.blocked).toEqual([{ ...source, kind: 'blocked_site', version: 2 }]);
    store.applySource(source);
    expect(store.sources.get().sources?.interests).toEqual([]);
    store.stop();
  });
});

describe('刚点了「不感兴趣」的一条等撤销', () => {
  function many(): ReturnType<typeof setup> & { ui: FeedUi; store: FeedStore } {
    const base = setup();
    for (let i = 0; i < COGNITION_PAGE_DEFAULT + 2; i += 1) {
      base.fake.control.feed.seedItem({ id: `f${String(i).padStart(3, '0')}`, title: `文章 ${i}` });
    }
    const ui = new FeedUi();
    return { ...base, ui, store: new FeedStore(base.fake.api, new EventsHub(base.fake.api.events), ui) };
  }

  it('就地留着、位置不变；分页位置照样重建，下一页不漏；撤销后照常留着', async () => {
    const { fake, ui, store } = many();
    await store.reload();
    const id = store.data.get().items[0]?.id ?? '';
    ui.markDismissed(id);
    store.applyItem(await fake.api.feed.react(id, { requestId: 'hide', version: 1, reaction: 'dislike' }));
    expect(store.data.get().items[0]).toMatchObject({ id, reaction: 'dislike' });
    await store.more();
    const ids = store.data.get().items.map((item) => item.id);
    expect(new Set(ids).size).toBe(COGNITION_PAGE_DEFAULT + 2);
    expect(ids[0]).toBe(id);
    store.applyItem(await fake.api.feed.react(id, { requestId: 'undo', version: 2, reaction: null }));
    expect(store.item(id)?.reaction).toBeNull();
    store.stop();
  });

  it('settleDismissed：占位清掉，那一条从列表收走；没点过的不动', async () => {
    const { fake, ui, store } = many();
    await store.reload();
    const id = store.data.get().items[1]?.id ?? '';
    ui.markDismissed(id);
    store.applyItem(await fake.api.feed.react(id, { requestId: 'hide', version: 1, reaction: 'dislike' }));
    expect(store.item(id)).toBeDefined();
    store.settleDismissed();
    expect(ui.store.get().dismissedIds.size).toBe(0);
    expect(store.item(id)).toBeUndefined();
    expect(store.data.get().items).toHaveLength(COGNITION_PAGE_DEFAULT - 1);
    store.stop();
  });
});

describe('切分段不先露出上一段的条目（11-11 第 1 条）', () => {
  it('没看过的分段先是读取中；看过的切回来先画上次的', async () => {
    const { fake, store } = setup();
    fake.control.feed.seedItem({ id: 'plain', title: '普通文章' });
    fake.control.feed.seedItem({ id: 'kept', title: '收藏的文章', saved: true });
    store.start();
    store.open();
    await waitFor(() => expect(store.data.get().items.map((item) => item.id).sort()).toEqual(['kept', 'plain']));
    const gate = Promise.withResolvers<void>();
    const list = fake.api.feed.list.bind(fake.api.feed);
    vi.spyOn(fake.api.feed, 'list').mockImplementation(async (query, signal) => {
      await gate.promise;
      return list(query, signal);
    });
    const toSaved = store.setSegment('saved');
    expect(store.data.get().status).toBe('loading');
    expect(store.data.get().items).toEqual([]);
    gate.resolve();
    await toSaved;
    expect(store.data.get().items.map((item) => item.id)).toEqual(['kept']);
    const back = store.setSegment('all');
    expect(store.data.get().items.map((item) => item.id).sort()).toEqual(['kept', 'plain']);
    await back;
    store.stop();
  });
});
