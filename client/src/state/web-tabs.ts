import {
  faviconHost, PROJECT_HUES, WEB_TABS_ARCHIVED_MAX, type ProjectHue, type WebTabsLayout,
} from '../api/shared.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';
import {
  emptyWebTabs,
  layoutOf,
  normalizeWebTabs,
  readCache,
  readLocalLegacy,
  writeCache,
  type ArchivedTab,
  type TabOpener,
  type WebTab,
  type WebTabGroup,
  type WebTabsState,
} from './web-tabs-storage.ts';

export type { ArchivedTab, TabOpener, WebTab, WebTabGroup, WebTabsState } from './web-tabs-storage.ts';

export type WebTabsStep = (state: WebTabsState) => WebTabsState;

const ARCHIVED_MAX = WEB_TABS_ARCHIVED_MAX;
export const NEW_GROUP_NAME = '新分组';

export type TabPlace = { list: 'pinned' } | { list: 'today' } | { list: 'group'; groupId: string };

const WEB_HASH_PREFIX = '#/web/';

export function webHash(id: string): string {
  return `${WEB_HASH_PREFIX}${encodeURIComponent(id)}`;
}

export function startOfToday(now: Date): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export function unusedHue(groups: readonly WebTabGroup[]): ProjectHue {
  const used = new Set(groups.map((group) => group.hue));
  return PROJECT_HUES.find((hue) => !used.has(hue)) ?? PROJECT_HUES[groups.length % PROJECT_HUES.length]!;
}

function without(list: readonly string[], id: string): string[] {
  return list.filter((candidate) => candidate !== id);
}

function insertAt(list: readonly string[], id: string, index: number): string[] {
  const rest = without(list, id);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

function detach(state: WebTabsState, id: string): WebTabsState {
  return {
    ...state,
    pinned: without(state.pinned, id),
    today: without(state.today, id),
    groups: state.groups.map((group) => (group.tabIds.includes(id)
      ? { ...group, tabIds: without(group.tabIds, id) } : group)),
  };
}

export function placeOf(state: WebTabsState, id: string): TabPlace | null {
  if (state.pinned.includes(id)) return { list: 'pinned' };
  if (state.today.includes(id)) return { list: 'today' };
  const group = state.groups.find((candidate) => candidate.tabIds.includes(id));
  return group === undefined ? null : { list: 'group', groupId: group.id };
}

export function orderedIds(state: WebTabsState): string[] {
  return [...state.pinned, ...state.groups.flatMap((group) => group.tabIds), ...state.today];
}

export class WebTabsStore {
  readonly store: Store<WebTabsState>;
  readonly loaded = new Store<ReadonlySet<string>>(new Set());
  readonly icons = new Store<ReadonlyMap<string, string>>(new Map());
  private sequence = 0;
  private readonly clock: () => Date;

  private serverVersion: number;
  readonly unsentAtStart: boolean;
  readonly localLegacy: WebTabsState | null;
  private pending: WebTabsStep[] = [];
  private readonly localListeners = new Set<() => void>();
  private readonly iconListeners = new Set<(report: { pageUrl: string; icon: string }) => void>();
  readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null, clock: () => Date = () => new Date()) {
    this.clock = clock;
    this.storage = storage;
    const cache = readCache(storage);
    this.localLegacy = readLocalLegacy(storage, clock().toISOString());
    this.serverVersion = cache?.serverVersion ?? 0;
    this.unsentAtStart = cache?.dirty ?? false;
    this.store = new Store(cache?.state ?? this.localLegacy ?? emptyWebTabs());
    this.store.subscribe(() => this.saveCache());
    this.archiveStale();
  }

  version(): number {
    return this.serverVersion;
  }

  layout(): WebTabsLayout {
    return layoutOf(this.get());
  }

  unsent(): number {
    return this.pending.length;
  }

  onLocalChange(listener: () => void): () => void {
    this.localListeners.add(listener);
    return () => {
      this.localListeners.delete(listener);
    };
  }

  acknowledge(count: number, version: number): void {
    this.pending = this.pending.slice(count);
    this.serverVersion = version;
    this.saveCache();
  }

  rebase(layout: WebTabsLayout, version: number): void {
    const current = this.get().current;
    const base = normalizeWebTabs({ ...layout, current });
    const next = this.pending.reduce((state, step) => step(state), base);
    this.serverVersion = version;
    this.store.set(() => normalizeWebTabs(next));
  }

  keepLocal(): void {
    this.pending.push((state) => state);
    this.saveCache();
  }

  private change(step: WebTabsStep): void {
    const before = this.get();
    this.store.set(step);
    if (this.get() === before) {
      return;
    }
    this.pending.push(step);
    this.saveCache();
    for (const listener of this.localListeners) {
      listener();
    }
  }

  private saveCache(): void {
    writeCache(this.storage, { serverVersion: this.serverVersion, dirty: this.pending.length > 0,
      state: this.get() });
  }

  get(): WebTabsState {
    return this.store.get();
  }

  tab(id: string): WebTab | null {
    return this.get().tabs.find((tab) => tab.id === id) ?? null;
  }

  live(): WebTab[] {
    const state = this.get();
    const loaded = this.loaded.get();
    const today = new Set(state.today);
    return state.tabs.filter((tab) => today.has(tab.id) || loaded.has(tab.id));
  }

  open(url: string, title: string, openedBy: TabOpener): string {
    const existing = this.get().tabs.find((tab) => tab.url === url);
    if (existing !== undefined) {
      this.activate(existing.id);
      return existing.id;
    }
    const id = this.newId();
    this.insert({ id, kind: 'web', url, title, openedBy, openedAt: this.now(), visitedAt: this.now() }, true);
    return id;
  }

  adopt(tab: { id: string; url: string; title: string; openedBy: TabOpener; activate: boolean }): string | null {
    if (this.tab(tab.id) === null) {
      this.insert({ id: tab.id, kind: 'web', url: tab.url, title: tab.title, openedBy: tab.openedBy,
        openedAt: this.now(), visitedAt: this.now() }, tab.activate);
    }
    if (!tab.activate) {
      return null;
    }
    this.activate(tab.id);
    return tab.id;
  }

  activate(id: string): void {
    if (this.tab(id) === null) {
      return;
    }
    const at = this.now();
    this.change((state) => ({ ...state, current: id,
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, visitedAt: at } : tab)) }));
    this.markLoaded(id);
  }

  update(id: string, patch: { url: string; title: string }): void {
    if (patch.url.trim() === '') {
      return;
    }
    const tab = this.tab(id);
    const title = patch.title.trim() === '' && tab?.url === patch.url ? tab.title : patch.title;
    if (tab === null || (tab.url === patch.url && tab.title === title)) {
      return;
    }
    this.change((state) => ({ ...state, tabs: state.tabs.map((candidate) => (candidate.id === id
      ? { ...candidate, url: patch.url, title } : candidate)) }));
  }

  setIcon(id: string, icon: string, pageUrl: string): void {
    const tab = this.tab(id);
    const site = faviconHost(pageUrl);
    if (tab === null || !icon.startsWith('data:image/') || site === null || faviconHost(tab.url) !== site
      || this.icons.get().get(id) === icon) {
      return;
    }
    this.icons.set((previous) => new Map([...previous, [id, icon]]));
    for (const listener of this.iconListeners) {
      listener({ pageUrl, icon });
    }
  }

  onIcon(listener: (report: { pageUrl: string; icon: string }) => void): () => void {
    this.iconListeners.add(listener);
    return () => {
      this.iconListeners.delete(listener);
    };
  }

  close(id: string): string | null {
    const state = this.get();
    const tab = this.tab(id);
    if (tab === null) {
      return state.current;
    }
    const order = orderedIds(state);
    const index = order.indexOf(id);
    const next = state.current !== id ? state.current
      : order[index + 1] ?? order[index - 1] ?? null;
    this.change((previous) => {
      const detached = detach(previous, id);
      return { ...detached, tabs: detached.tabs.filter((candidate) => candidate.id !== id),
        current: previous.current === id ? next : previous.current,
        archived: [this.archiveEntry(tab), ...detached.archived].slice(0, ARCHIVED_MAX) };
    });
    this.unload(id);
    return next;
  }

  reopen(key: string): string | null {
    const entry = this.get().archived.find((candidate) => candidate.key === key);
    if (entry === undefined) {
      return null;
    }
    this.change((state) => ({ ...state, archived: state.archived.filter((candidate) => candidate.key !== key) }));
    return this.open(entry.url, entry.title, 'user');
  }

  move(id: string, place: TabPlace, index: number): void {
    if (this.tab(id) === null) {
      return;
    }
    this.change((state) => {
      const detached = detach(state, id);
      if (place.list === 'pinned') return { ...detached, pinned: insertAt(detached.pinned, id, index) };
      if (place.list === 'today') return { ...detached, today: insertAt(detached.today, id, index) };
      if (!detached.groups.some((group) => group.id === place.groupId)) return state;
      return { ...detached, groups: detached.groups.map((group) => (group.id === place.groupId
        ? { ...group, tabIds: insertAt(group.tabIds, id, index) } : group)) };
    });
  }

  pin(id: string): void {
    this.move(id, { list: 'pinned' }, this.get().pinned.length);
  }

  release(id: string): void {
    this.move(id, { list: 'today' }, 0);
    this.touch(id);
  }

  createGroup(tabIds: readonly string[], name: string = NEW_GROUP_NAME): string {
    const id = `group-${this.newId()}`;
    this.change((state) => {
      const known = tabIds.filter((tabId) => state.tabs.some((tab) => tab.id === tabId));
      const detached = known.reduce(detach, state);
      return { ...detached, groups: [...detached.groups,
        { id, name, hue: unusedHue(detached.groups), collapsed: false, tabIds: known }] };
    });
    return id;
  }

  renameGroup(groupId: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed !== '') this.patchGroup(groupId, { name: trimmed });
  }

  recolorGroup(groupId: string, hue: ProjectHue): void {
    this.patchGroup(groupId, { hue });
  }

  toggleGroup(groupId: string): void {
    const group = this.get().groups.find((candidate) => candidate.id === groupId);
    if (group !== undefined) this.patchGroup(groupId, { collapsed: !group.collapsed });
  }

  ungroup(groupId: string): void {
    this.change((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId);
      if (group === undefined) return state;
      return { ...state, groups: state.groups.filter((candidate) => candidate.id !== groupId),
        today: [...group.tabIds, ...state.today] };
    });
  }

  moveGroup(groupId: string, index: number): void {
    this.change((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId);
      if (group === undefined) return state;
      const rest = state.groups.filter((candidate) => candidate.id !== groupId);
      const at = Math.max(0, Math.min(rest.length, index));
      return { ...state, groups: [...rest.slice(0, at), group, ...rest.slice(at)] };
    });
  }

  archiveStale(): void {
    const start = startOfToday(this.clock());
    const state = this.get();
    const stale = state.tabs.filter((tab) => state.today.includes(tab.id) && tab.id !== state.current
      && tab.visitedAt < start);
    if (stale.length === 0) {
      return;
    }
    const ids = new Set(stale.map((tab) => tab.id));
    this.change((previous) => ({ ...previous,
      tabs: previous.tabs.filter((tab) => !ids.has(tab.id)),
      today: previous.today.filter((id) => !ids.has(id)),
      archived: [...stale.map((tab) => this.archiveEntry(tab)), ...previous.archived].slice(0, ARCHIVED_MAX) }));
  }

  private insert(tab: WebTab, activate: boolean): void {
    this.change((state) => ({ ...state, tabs: [...state.tabs, tab], today: [tab.id, ...state.today],
      current: activate ? tab.id : state.current }));
  }

  private touch(id: string): void {
    const at = this.now();
    this.change((state) => ({ ...state,
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, visitedAt: at } : tab)) }));
  }

  private patchGroup(groupId: string, patch: Partial<Omit<WebTabGroup, 'id' | 'tabIds'>>): void {
    this.change((state) => ({ ...state,
      groups: state.groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)) }));
  }

  private markLoaded(id: string): void {
    if (!this.loaded.get().has(id)) {
      this.loaded.set((previous) => new Set([...previous, id]));
    }
  }

  private unload(id: string): void {
    if (this.loaded.get().has(id)) {
      this.loaded.set((previous) => new Set([...previous].filter((candidate) => candidate !== id)));
    }
  }

  private archiveEntry(tab: WebTab): ArchivedTab {
    return { key: `${tab.id}@${this.now()}`, url: tab.url, title: tab.title, closedAt: this.now() };
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private newId(): string {
    this.sequence += 1;
    return `web-${this.clock().getTime().toString(36)}-${this.sequence}-${Math.random().toString(36).slice(2, 6)}`;
  }
}
