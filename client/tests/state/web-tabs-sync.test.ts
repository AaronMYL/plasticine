import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent, ConnectionStatus } from '../../src/api/types.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { Store } from '../../src/state/store.ts';
import { WebTabsStore } from '../../src/state/web-tabs.ts';
import { WEB_TABS_PUSH_DELAY_MS, WebTabsSync, type SyncHub } from '../../src/state/web-tabs-sync.ts';
import { WEB_TABS_STORAGE_KEY, WEB_TABS_UPLOADED_KEY } from '../../src/state/web-tabs-storage.ts';
import { memoryStorage } from '../helpers.tsx';

const NOON = new Date('2026-11-08T04:00:00.000Z');

function tab(id: string, url: string) {
  return { id, kind: 'web' as const, url, title: id, openedBy: 'user' as const, openedAt: NOON.toISOString(),
    visitedAt: NOON.toISOString() };
}

function hub(): SyncHub & { emit: (event: LiveEvent) => void } {
  const listeners = new Set<(event: LiveEvent) => void>();
  return {
    status: new Store<ConnectionStatus>('open'),
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (event) => listeners.forEach((listener) => listener(event)),
  };
}

function server() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOON });
  fake.control.session.signInForDevelopment('测试');
  return fake.control.webTabs;
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(WEB_TABS_PUSH_DELAY_MS + 10);
}

describe('vertical tabs sync with server', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads server snapshot on connect and pushes debounced local changes bumping version', async () => {
    const api = server();
    api.seed({ tabs: [tab('a', 'https://a.example/')], pinned: [], groups: [], today: ['a'], archived: [] });
    const tabs = new WebTabsStore(memoryStorage(), () => NOON);
    const sync = new WebTabsSync({ tabs, api, hub: hub(), now: () => NOON });
    await sync.load();
    expect(tabs.get().today).toEqual(['a']);
    expect(tabs.version()).toBe(1);
    tabs.pin('a');
    sync.start();
    await settle();
    expect(api.current().layout.pinned).toEqual(['a']);
    expect(tabs.version()).toBe(2);
    expect(tabs.unsent()).toBe(0);
    sync.stop();
  });

  it('replays local operations onto newer remote snapshot so edits from both devices survive', async () => {
    const api = server();
    api.seed({ tabs: [tab('a', 'https://a.example/')], pinned: [], groups: [], today: ['a'], archived: [] });
    const mine = new WebTabsStore(memoryStorage(), () => NOON);
    const sync = new WebTabsSync({ tabs: mine, api, hub: hub(), now: () => NOON });
    await sync.load();
    await api.put({ requestId: 'other-device-1', baseVersion: 1, layout: { tabs: [tab('a', 'https://a.example/'),
      tab('b', 'https://b.example/')], pinned: [], groups: [], today: ['b', 'a'], archived: [] } });
    const c = mine.open('https://c.example/', 'C', 'user');
    await sync.flush();
    const saved = api.current();
    expect(saved.layout.today).toEqual([c, 'b', 'a']);
    expect(mine.get().today).toEqual([c, 'b', 'a']);
    expect(mine.version()).toBe(saved.version);
  });

  it('merges legacy local tabs on first connect skipping duplicate URLs then deletes local copy', async () => {
    const api = server();
    api.seed({ tabs: [tab('a', 'https://a.example/')], pinned: [], groups: [], today: ['a'], archived: [] });
    const storage = memoryStorage();
    storage.setItem(WEB_TABS_STORAGE_KEY, JSON.stringify({ version: 1, tabs: [tab('x', 'https://a.example/'),
      tab('y', 'https://y.example/')], pinned: ['y'], groups: [], today: ['x'], current: 'y', archived: [],
    bookmarksMerged: true }));
    const tabs = new WebTabsStore(storage, () => NOON);
    expect(tabs.get().pinned).toEqual(['y']);
    await new WebTabsSync({ tabs, api, hub: hub(), now: () => NOON }).load();
    expect(api.current().layout.tabs.map((entry) => entry.url).sort()).toEqual(['https://a.example/',
      'https://y.example/']);
    expect(tabs.get().pinned).toEqual(['y']);
    expect(storage.getItem(WEB_TABS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(WEB_TABS_UPLOADED_KEY)).not.toBeNull();
    const again = new WebTabsStore(storage, () => NOON);
    expect(again.localLegacy).toBeNull();
    expect(again.get().pinned).toEqual(['y']);
  });

  it('refetches on remote version event when no local changes are pending', async () => {
    const api = server();
    api.seed({ tabs: [tab('a', 'https://a.example/')], pinned: [], groups: [], today: ['a'], archived: [] });
    const tabs = new WebTabsStore(memoryStorage(), () => NOON);
    const events = hub();
    const sync = new WebTabsSync({ tabs, api, hub: events, now: () => NOON });
    sync.start();
    await vi.waitFor(() => expect(tabs.version()).toBe(1));
    await api.put({ requestId: 'other-device-2', baseVersion: 1, layout: { tabs: [tab('a', 'https://a.example/')],
      pinned: ['a'], groups: [], today: [], archived: [] } });
    events.emit({ type: 'webTabs.changed', version: 2 });
    await vi.waitFor(() => expect(tabs.get().pinned).toEqual(['a']));
    sync.stop();
  });

  it('keeps offline changes locally marked unsynced, renders immediately, pushes on reconnect', async () => {
    const api = server();
    const storage = memoryStorage();
    const tabs = new WebTabsStore(storage, () => NOON);
    const sync = new WebTabsSync({ tabs, api, hub: hub(), now: () => NOON });
    await sync.load();
    vi.spyOn(api, 'put').mockRejectedValueOnce(new Error('断网'));
    tabs.open('https://offline.example/', '离线开的', 'user');
    await sync.flush();
    expect(tabs.unsent()).toBe(1);
    const reopened = new WebTabsStore(storage, () => NOON);
    expect(reopened.unsentAtStart).toBe(true);
    expect(reopened.get().tabs.map((entry) => entry.url)).toEqual(['https://offline.example/']);
    await new WebTabsSync({ tabs: reopened, api, hub: hub(), now: () => NOON }).load();
    expect(api.current().layout.tabs.map((entry) => entry.url)).toEqual(['https://offline.example/']);
  });
});
