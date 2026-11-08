// 竖排标签（《优化清单》第 2 条，11-06 定、11-07 设计稿 Web；参考 Arc、Edge）：只有网页是标签，Plasticine 自己的页面
// 是导航。网页栏目的第二栏从上到下：置顶（一排图标）、分组（他自己建的，能整组收起）、今天打开的。
// · 新开的网页放在「今天」最上面；同一个网址已经开着就切过去，不开第二个。
// · 「今天」只放今天切到过的：过了一天没再看的收进「关掉的」（⌘K 搜得到、点了重开），置顶和分组里的一直在。
// · 每个标签恰好在一处；关掉、过期都只是挪进「关掉的」，不删。
// · 原生网页（Mac 的 WKWebView）只开「用到了的」：今天的标签，加上这次打开后点过的置顶 / 分组标签（loaded）。
// 11-08 起摆放存在本体里（每台设备同一份）：这里的每一步改动都是「整份 → 整份」的一步，记在 pending 里；同步
// （web-tabs-sync.ts）把整份送上去，别的设备先改过时在本体那一份上把这几步重做一遍（rebase）。在看哪一个、原生网页开了
// 哪些只在这台设备上。打开时先画上次的缓存（web-tabs-storage.ts），没有缓存时先画这台设备上还没并上去的旧存档。

import { faviconHost, WEB_TABS_ARCHIVED_MAX, type ProjectHue, type WebTabsLayout } from '../api/shared.ts';
import { PROJECT_HUES } from '../api/shared.ts';
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

/** 改摆放的一步：整份进、整份出（重放在别的底子上也要成立：找不到的标签就什么都不做）。 */
export type WebTabsStep = (state: WebTabsState) => WebTabsState;

/** 「关掉的」最多记这么多（够 ⌘K 找回近几周的），再早的不再列。 */
const ARCHIVED_MAX = WEB_TABS_ARCHIVED_MAX;
/** 新建分组的名字（接着就能改）。 */
export const NEW_GROUP_NAME = '新分组';

/** 标签放在哪：置顶、某一组、今天。 */
export type TabPlace = { list: 'pinned' } | { list: 'today' } | { list: 'group'; groupId: string };

const WEB_HASH_PREFIX = '#/web/';

/** 网页标签在地址栏里的样子（#/web/<标签 id>）：刷新、前进后退都还停在这个网页标签上。 */
export function webHash(id: string): string {
  return `${WEB_HASH_PREFIX}${encodeURIComponent(id)}`;
}

/** 本地时区今天零点（ISO）：「今天」按它清。 */
export function startOfToday(now: Date): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** 新建一组时挑一个还没用过的颜色；都用过了从头再来。 */
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

/** 从各处拿掉这个标签（挪动、关掉的第一步）。 */
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

/** 竖排从上到下的顺序（键盘上下切、关掉后落到哪个）。 */
export function orderedIds(state: WebTabsState): string[] {
  return [...state.pinned, ...state.groups.flatMap((group) => group.tabIds), ...state.today];
}

export class WebTabsStore {
  readonly store: Store<WebTabsState>;
  /** 这次打开后用到了的置顶 / 分组标签：原生网页只开这些和今天的。 */
  readonly loaded = new Store<ReadonlySet<string>>(new Set());
  /** 桌面壳报来的网站图标（标签 id → 图片地址，页面自己的 favicon）；只在这台设备上、不存。 */
  readonly icons = new Store<ReadonlyMap<string, string>>(new Map());
  private sequence = 0;
  private readonly clock: () => Date;

  /** 上次和本体对上的版本（0 = 还没对上过）。 */
  private serverVersion: number;
  /** 上次关掉前还有没送上去的（缓存里的 dirty）：连上时并上去。 */
  readonly unsentAtStart: boolean;
  /** 这台设备上还没并上本体的旧存档（打开时读一次）。 */
  readonly localLegacy: WebTabsState | null;
  /** 还没送上去的几步（按先后）。 */
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

  /** 这台设备手上那一份对应的本体版本。 */
  version(): number {
    return this.serverVersion;
  }

  /** 送给本体的那一份摆放（不含这台设备在看哪一个）。 */
  layout(): WebTabsLayout {
    return layoutOf(this.get());
  }

  /** 还没送上去的步数。 */
  unsent(): number {
    return this.pending.length;
  }

  /** 本机改了一步（同步据此排一次送）。返回取消监听的函数。 */
  onLocalChange(listener: () => void): () => void {
    this.localListeners.add(listener);
    return () => {
      this.localListeners.delete(listener);
    };
  }

  /** 送上去的前 count 步本体收下了，现在是 version。 */
  acknowledge(count: number, version: number): void {
    this.pending = this.pending.slice(count);
    this.serverVersion = version;
    this.saveCache();
  }

  /** 本体那一份（version）：在它上面把还没送上去的几步重做一遍；在看的那一个还在就留着。 */
  rebase(layout: WebTabsLayout, version: number): void {
    const current = this.get().current;
    const base = normalizeWebTabs({ ...layout, current });
    const next = this.pending.reduce((state, step) => step(state), base);
    this.serverVersion = version;
    this.store.set(() => normalizeWebTabs(next));
  }

  /** 手上这一份整份就是要送的（上次关掉前没送完）：记一步「照这一份」。 */
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

  /** 原生网页该开着的：今天的，加上这次点过的置顶 / 分组标签。 */
  live(): WebTab[] {
    const state = this.get();
    const loaded = this.loaded.get();
    const today = new Set(state.today);
    return state.tabs.filter((tab) => today.has(tab.id) || loaded.has(tab.id));
  }

  /** 打开一个网页：同一个网址已经有标签就切过去；否则放在「今天」最上面。返回标签 id。 */
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

  /** 原生层自己开的（网页里的新窗口、Plasticine 的 tab_open）：用原生给的 id。返回要切到的 id，不切是 null。 */
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

  /** 原生层报来的网址、标题；还在载入、标题是空的时候留着原来的标题；网址是空的整条不收。 */
  update(id: string, patch: { url: string; title: string }): void {
    // 空网址不收：本体要求网址至少一个字，收了整份摆放就送不上去（PUT /v2/web-tabs 一直 400）。
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

  /**
   * 桌面壳报来这个标签的网站图标变了（只收 data:image/）：图标属于的那一页（pageUrl）要和标签现在的网站是同一个，
   * 换了网站后晚到的旧图标不要。收下了告诉同步（按网站存进本体，别的设备也用上）。
   */
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

  /** 壳报来的图标收下了（同步拿去存进本体）。返回取消监听的函数。 */
  onIcon(listener: (report: { pageUrl: string; icon: string }) => void): () => void {
    this.iconListeners.add(listener);
    return () => {
      this.iconListeners.delete(listener);
    };
  }

  /** 关掉：挪进「关掉的」。返回该落到的下一个标签（关的是当前那个时），没有是 null。 */
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

  /** 从「关掉的」重开一个：返回新的标签 id。 */
  reopen(key: string): string | null {
    const entry = this.get().archived.find((candidate) => candidate.key === key);
    if (entry === undefined) {
      return null;
    }
    this.change((state) => ({ ...state, archived: state.archived.filter((candidate) => candidate.key !== key) }));
    return this.open(entry.url, entry.title, 'user');
  }

  /** 挪到某处的第 index 个（拖动排序、右键「置顶」「移到分组」）。 */
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

  /** 取消置顶 / 拿出分组：回到「今天」最上面（算今天看过）。 */
  release(id: string): void {
    this.move(id, { list: 'today' }, 0);
    this.touch(id);
  }

  /** 新建一组，把这些标签放进去；返回组 id。 */
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

  /** 解散一组：组里的标签回到「今天」最上面，一个不丢。 */
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

  /** 「今天」里不是今天切到过的（也不是当前那个）收进「关掉的」。 */
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
