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
export const WEB_TABS_STORAGE_KEY = 'plasticine:web-tabs';
export const LEGACY_TABS_STORAGE_KEY = 'plasticine:tabs';
export const WEB_TABS_UPLOADED_KEY = 'plasticine:web-tabs-uploaded';
const CACHE_VERSION = 1;

export type WebTabsState = WebTabsLayout & {
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
    console.warn(`${what}没读到，当没有`, cause);
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

export function markLocalUploaded(storage: KeyValueStorage | null, at: string): void {
  try {
    storage?.setItem(WEB_TABS_UPLOADED_KEY, at);
    storage?.removeItem(WEB_TABS_STORAGE_KEY);
  } catch (cause) {
    console.warn('没能记下「旧的竖排标签已经并上去」，下次连上会再并一次（同一个网址不会重复）。', cause);
  }
}
