import { describe, expect, it } from 'vitest';
import {
  orderedIds,
  placeOf,
  WebTabsStore,
} from '../../src/state/web-tabs.ts';
import { LEGACY_TABS_STORAGE_KEY } from '../../src/state/web-tabs-storage.ts';
import { memoryStorage } from '../helpers.tsx';

const NOON = new Date('2026-11-07T04:00:00.000Z');

describe('vertical tabs state', () => {
  it('opens new URL at top of Today and activates it; existing URL switches without duplicating', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const b = tabs.open('https://b.example', 'B', 'user');
    expect(tabs.get().today).toEqual([b, a]);
    expect(tabs.get().current).toBe(b);
    expect(tabs.open('https://a.example', 'A again', 'user')).toBe(a);
    expect(tabs.get().tabs).toHaveLength(2);
    expect(tabs.get().current).toBe(a);
  });

  it('ignores empty native URL updates, keeping existing URL and title', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    tabs.update(a, { url: '', title: '' });
    tabs.update(a, { url: ' ', title: '新标题' });
    expect(tabs.tab(a)).toMatchObject({ url: 'https://a.example', title: 'A' });
    expect(tabs.layout().tabs.map((tab) => tab.url)).toEqual(['https://a.example']);
  });

  it('pinning, grouping, and ungrouping keep each tab in one place, returning to top of Today', () => {
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

  it('ungrouping a group returns all its tabs to Today without losing any', () => {
    const tabs = new WebTabsStore(null, () => NOON);
    const a = tabs.open('https://a.example', 'A', 'user');
    const group = tabs.createGroup([a]);
    tabs.ungroup(group);
    expect(tabs.get().groups).toEqual([]);
    expect(tabs.get().today).toEqual([a]);
  });

  it('closing active tab selects next vertical tab and moves closed tab to reopenable list', () => {
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

  it('rolls inactive yesterday Today tabs into Closed next day while keeping pinned and groups', () => {
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

  it('only spawns native web views for Today tabs and clicked pinned/grouped tabs', () => {
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

  it('migrates legacy top tabs once keeping web tabs/groups, dropping app tabs and keeping backup', () => {
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
