// 竖排标签在这台设备上存的东西（11-08 起摆放存在本体里，见 web-tabs-sync.ts）：
// · 缓存（plasticine:web-tabs-cache）：上次和本体对上的那一份、它的版本、这台设备在看哪一个，打开时先画它（不等网）；
//   dirty 表示关掉前还有几步没送上去，下次连上时并上去。
// · 旧存档：11-07 shell 线存在 localStorage 的那一份（plasticine:web-tabs），和更早的顶部标签（plasticine:tabs，第 1–4
//   版，只读）。第一次连上本体时并上去（merge：同一个网址已经有了的跳过），然后删掉 plasticine:web-tabs、记一笔已搬；
//   plasticine:tabs 照旧不删（升级不留旧版之前那一份），记了已搬就不再读它。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { emptyLayout, normalizeLayout } from '../../../agent/shared/web-tabs-layout.ts';
import {
  ArchivedTabSchema,
  PROJECT_HUES,
  WebTabGroupSchema,
  WebTabOpenerSchema,
  WebTabSchema,
  type WebTab,
  type WebTabGroup,
  type WebTabsLayout,
} from '../api/shared.ts';
import type { KeyValueStorage } from './outbox.ts';

export type { ArchivedTab, TabOpener, WebTab, WebTabGroup, WebTabsLayout } from '../api/shared.ts';

export const WEB_TABS_CACHE_KEY = 'plasticine:web-tabs-cache';
/** 11-07 存在这台设备上的竖排标签：并上本体后删掉。 */
export const WEB_TABS_STORAGE_KEY = 'plasticine:web-tabs';
/** 旧的顶部标签存档：只读，迁完不删。 */
export const LEGACY_TABS_STORAGE_KEY = 'plasticine:tabs';
/** 这台设备的旧存档已经并上本体了：不再读、不再并。 */
export const WEB_TABS_UPLOADED_KEY = 'plasticine:web-tabs-uploaded';
const CACHE_VERSION = 1;

/** 这台设备上的竖排标签：本体那一份摆放，加上这台设备在看哪一个。 */
export type WebTabsState = WebTabsLayout & {
  /** 上次在看的网页标签（点「网页」回到它）；没有是 null。每台设备各自记。 */
  current: string | null;
};

const LayoutFields = {
  tabs: Type.Array(WebTabSchema),
  pinned: Type.Array(Type.String({ minLength: 1 })),
  groups: Type.Array(WebTabGroupSchema),
  today: Type.Array(Type.String({ minLength: 1 })),
  archived: Type.Array(ArchivedTabSchema),
};

const CacheSchema = Type.Object({
  version: Type.Literal(CACHE_VERSION),
  serverVersion: Type.Integer({ minimum: 0 }),
  dirty: Type.Boolean(),
  current: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  layout: Type.Object(LayoutFields),
});

/** 11-07 那一份（第 1 版）：摆放 + 在看哪一个 + 书签搬过没有。 */
const LocalStoredSchema = Type.Object({ version: Type.Literal(1), ...LayoutFields,
  current: Type.Union([Type.String({ minLength: 1 }), Type.Null()]) });

export interface WebTabsCache {
  serverVersion: number;
  dirty: boolean;
  state: WebTabsState;
}

export function emptyWebTabs(): WebTabsState {
  return { ...emptyLayout(), current: null };
}

/** 规整摆放，在看的那一个不在了就是 null。 */
export function normalizeWebTabs(state: WebTabsState): WebTabsState {
  const layout = normalizeLayout(layoutOf(state));
  const current = state.current !== null && layout.tabs.some((tab) => tab.id === state.current) ? state.current
    : null;
  return { ...layout, current };
}

export function layoutOf(state: WebTabsState): WebTabsLayout {
  return { tabs: state.tabs, pinned: state.pinned, groups: state.groups, today: state.today,
    archived: state.archived };
}

function parse(raw: string | null, what: string): unknown {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    console.warn(`${what}读不出来，当没有`, cause);
    return null;
  }
}

export function readCache(storage: KeyValueStorage | null): WebTabsCache | null {
  const parsed = parse(storage?.getItem(WEB_TABS_CACHE_KEY) ?? null, '竖排标签的缓存');
  if (parsed === null) {
    return null;
  }
  if (!Value.Check(CacheSchema, parsed)) {
    console.warn('竖排标签的缓存格式不对，等本体那一份');
    return null;
  }
  return { serverVersion: parsed.serverVersion, dirty: parsed.dirty,
    state: normalizeWebTabs({ ...parsed.layout, current: parsed.current }) };
}

export function writeCache(storage: KeyValueStorage | null, cache: WebTabsCache): void {
  try {
    storage?.setItem(WEB_TABS_CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, serverVersion: cache.serverVersion,
      dirty: cache.dirty, current: cache.state.current, layout: layoutOf(cache.state) }));
  } catch (cause) {
    console.warn('竖排标签的缓存没能存下，当前操作不受影响。', cause);
  }
}

// ---- 旧的顶部标签存档（第 1–4 版） ----

const LegacyWebTabSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: Type.Literal('web'),
  url: Type.String({ minLength: 1 }),
  title: Type.String(),
  openedBy: WebTabOpenerSchema,
  groupId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
const LegacyGroupSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  hue: Type.Enum(PROJECT_HUES),
  collapsed: Type.Boolean(),
});
const LegacyStoredSchema = Type.Object({
  version: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4)]),
  tabs: Type.Array(Type.Unknown()),
  current: Type.String(),
  groups: Type.Optional(Type.Array(Type.Unknown())),
});
type LegacyVisits = Readonly<Record<string, string>>;
const LEGACY_VISITS_KEY = 'plasticine:tab-visits';

function readLegacyVisits(storage: KeyValueStorage): LegacyVisits {
  const parsed = parse(storage.getItem(LEGACY_VISITS_KEY), '旧标签的上次切到时间');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'));
}

/**
 * 旧的顶部标签（第 1–4 版）搬成竖排标签：网页标签一个不丢，在组里的进同名的组，别的进「今天」（时间记成上次切到它的
 * 时间，没记过的记成现在，免得一升级就被当成昨天的收走）；组里只剩 Plasticine 自己页面的组不建。读不出是 null。
 */
export function fromLegacyTabs(storage: KeyValueStorage, now: string): WebTabsState | null {
  const parsed = parse(storage.getItem(LEGACY_TABS_STORAGE_KEY), '旧的顶部标签');
  if (parsed === null || !Value.Check(LegacyStoredSchema, parsed)) {
    return null;
  }
  const visits = readLegacyVisits(storage);
  const webTabs = parsed.tabs.filter((tab): tab is Static<typeof LegacyWebTabSchema> =>
    Value.Check(LegacyWebTabSchema, tab));
  const legacyGroups = (parsed.groups ?? []).filter((group): group is Static<typeof LegacyGroupSchema> =>
    Value.Check(LegacyGroupSchema, group));
  const tabs: WebTab[] = webTabs.map((tab) => {
    const at = visits[tab.id] ?? now;
    return { id: tab.id, kind: 'web', url: tab.url, title: tab.title, openedBy: tab.openedBy, openedAt: at,
      visitedAt: at };
  });
  const groups: WebTabGroup[] = legacyGroups.map((group) => ({ id: group.id, name: group.name, hue: group.hue,
    collapsed: group.collapsed, tabIds: webTabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id) }))
    .filter((group) => group.tabIds.length > 0);
  const grouped = new Set(groups.flatMap((group) => group.tabIds));
  const today = webTabs.filter((tab) => !grouped.has(tab.id)).map((tab) => tab.id);
  const current = webTabs.some((tab) => tab.id === parsed.current) ? parsed.current : null;
  return normalizeWebTabs({ ...emptyWebTabs(), tabs, groups, today, current });
}

/** 这台设备上还没并上本体的旧存档（11-07 那一份，没有再看更早的顶部标签）；已经并过或没有是 null。 */
export function readLocalLegacy(storage: KeyValueStorage | null, now: string): WebTabsState | null {
  if (storage === null || storage.getItem(WEB_TABS_UPLOADED_KEY) !== null) {
    return null;
  }
  const parsed = parse(storage.getItem(WEB_TABS_STORAGE_KEY), '这台设备上的竖排标签');
  if (parsed !== null) {
    if (Value.Check(LocalStoredSchema, parsed)) {
      const { version: _version, ...state } = parsed;
      return normalizeWebTabs(state);
    }
    console.warn('这台设备上的竖排标签格式不对，没有并上去（原样留着）');
    return null;
  }
  return fromLegacyTabs(storage, now);
}

/** 旧存档并上本体了：删掉 11-07 那一份，记一笔（更早的顶部标签不删，记了就不再读）。 */
export function markLocalUploaded(storage: KeyValueStorage | null, at: string): void {
  try {
    storage?.setItem(WEB_TABS_UPLOADED_KEY, at);
    storage?.removeItem(WEB_TABS_STORAGE_KEY);
  } catch (cause) {
    console.warn('没能记下「旧的竖排标签已经并上去」，下次连上会再并一次（同一个网址不会重复）。', cause);
  }
}
