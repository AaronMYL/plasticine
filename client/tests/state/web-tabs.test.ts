// 竖排标签（《优化清单》第 2 条）：只有网页是标签；置顶、分组、今天三处，每个标签恰好在一处；关掉和过期都只挪进
// 「关掉的」；旧的顶部标签先画出来（并上本体在 web-tabs-sync.test.ts），旧的那一份不删。书签在服务端迁移里搬。

import { describe, expect, it } from 'vitest';
import {
  orderedIds,
  placeOf,
  WebTabsStore,
} from '../../src/state/web-tabs.ts';
import { LEGACY_TABS_STORAGE_KEY } from '../../src/state/web-tabs-storage.ts';
import { memoryStorage } from '../helpers.tsx';

const NOON = new Date('2026-11-07T04:00:00.000Z');

describe('竖排标签', () => {
  it('新开的网页放在「今天」最上面并切过去；同一个网址再开是切过去，不开第二个', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const b = tabs.open('https://b.example', 'B', 'user');
    expect(tabs.get().today).toEqual([b, a]);
    expect(tabs.get().current).toBe(b);
    expect(tabs.open('https://a.example', 'A again', 'user')).toBe(a);
    expect(tabs.get().tabs).toHaveLength(2);
    expect(tabs.get().current).toBe(a);
  });

  it('原生层报来空网址不收（网址、标题留着原来的）', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    tabs.update(a, { url: '', title: '' });
    tabs.update(a, { url: ' ', title: '新标题' });
    expect(tabs.tab(a)).toMatchObject({ url: 'https://a.example', title: 'A' });
    expect(tabs.layout().tabs.map((tab) => tab.url)).toEqual(['https://a.example']);
  });

  it('置顶、放进分组、拿出来：每个标签恰好在一处，拿出来回到「今天」最上面', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const b = tabs.open('https://b.example', 'B', 'user');
    tabs.pin(a);
    expect(placeOf(tabs.get(), a)).toEqual({ list: 'pinned' });
    const group = tabs.createGroup([b], '研究');
    expect(placeOf(tabs.get(), b)).toEqual({ list: 'group', groupId: group });
    expect(tabs.get().today).toEqual([]);
    tabs.move(a, { list: 'group', groupId: group }, 0);
    expect(tabs.get().groups[0]!.tabIds).toEqual([a, b]);
    expect(tabs.get().pinned).toEqual([]);
    tabs.release(b);
    expect(tabs.get().today).toEqual([b]);
    expect(orderedIds(tabs.get())).toEqual([a, b]);
  });

  it('解散一组：标签一个不丢，回到「今天」', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const group = tabs.createGroup([a]);
    tabs.ungroup(group);
    expect(tabs.get().groups).toEqual([]);
    expect(tabs.get().today).toEqual([a]);
  });

  it('关掉当前那个落到竖排的下一个；关掉的进「关掉的」，能重开', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const b = tabs.open('https://b.example', 'B', 'user');
    expect(tabs.close(b)).toBe(a);
    expect(tabs.get().current).toBe(a);
    const key = tabs.get().archived[0]!.key;
    expect(tabs.get().archived[0]!.url).toBe('https://b.example');
    const reopened = tabs.reopen(key);
    expect(tabs.tab(reopened!)?.url).toBe('https://b.example');
    expect(tabs.get().archived).toEqual([]);
  });

  it('「今天」里昨天以前切到过的、不是当前的，第二天打开时收进「关掉的」；置顶和分组里的不动', () => {
    const storage = memoryStorage();
    const yesterday = new Date('2026-11-06T04:00:00.000Z');
    const before = new WebTabsStore(storage, () => yesterday);
    const old = before.open('https://old.example', 'Old', 'user');
    const kept = before.open('https://kept.example', 'Kept', 'user');
    const pinned = before.open('https://pin.example', 'Pin', 'user');
    before.pin(pinned);
    before.activate(kept);
    const after = new WebTabsStore(storage, () => NOON);
    expect(after.tab(old)).toBeNull();
    expect(after.get().archived.map((entry) => entry.url)).toEqual(['https://old.example']);
    expect(after.get().today).toEqual([kept]);
    expect(after.get().pinned).toEqual([pinned]);
  });

  it('原生网页只开今天的和这次点过的置顶 / 分组标签', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const b = tabs.open('https://b.example', 'B', 'user');
    tabs.pin(a);
    tabs.createGroup([b]);
    const fresh = new WebTabsStore(null, () => NOON);
    expect(fresh.live()).toEqual([]);
    tabs.loaded.set(new Set());
    expect(tabs.live()).toEqual([]);
    tabs.activate(b);
    expect(tabs.live().map((tab) => tab.id)).toEqual([b]);
  });

  it('旧的顶部标签搬过来一次：网页标签和分组都在，Plasticine 页面不再是标签，旧存档留着', () => {
    const storage = memoryStorage();
    const legacy = JSON.stringify({ version: 4, current: 'w2', tabs: [
      { id: 'pin:today', kind: 'page', pinned: 'today', history: ['#/today'], index: 0, title: null,
        openedBy: 'user', groupId: null, autoGrouped: false },
      { id: 'w1', kind: 'web', url: 'https://hunter.example', title: '登记表', openedBy: 'user', groupId: 'g1',
        autoGrouped: false },
      { id: 'p1', kind: 'page', pinned: null, history: ['#/notes/n1'], index: 0, title: '回访', openedBy: 'user',
        groupId: 'g1', autoGrouped: false },
      { id: 'w2', kind: 'web', url: 'https://read.example', title: '读', openedBy: 'plasticine', groupId: null,
        autoGrouped: false },
    ], groups: [{ id: 'g1', name: 'Cyber Hunter', hue: 'teal', collapsed: false },
      { id: 'g2', name: '空的', hue: 'sky', collapsed: false }] });
    storage.setItem(LEGACY_TABS_STORAGE_KEY, legacy);
    const tabs = new WebTabsStore(storage, () => NOON);
    expect(tabs.get().groups).toEqual([{ id: 'g1', name: 'Cyber Hunter', hue: 'teal', collapsed: false,
      tabIds: ['w1'] }]);
    expect(tabs.get().today).toEqual(['w2']);
    expect(tabs.get().current).toBe('w2');
    expect(storage.getItem(LEGACY_TABS_STORAGE_KEY)).toBe(legacy);
    expect(tabs.localLegacy?.today).toEqual(['w2']);
  });
});
