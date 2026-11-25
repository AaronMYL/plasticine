import {
  WEB_TABS_ARCHIVED_MAX,
  WEB_TAB_TITLE_MAX,
  type WebTab,
  type WebTabGroup,
  type WebTabsLayout,
} from './api/web-tabs.ts';

export function emptyLayout(): WebTabsLayout {
  return { tabs: [], pinned: [], groups: [], today: [], archived: [] };
}

function clip(title: string): string {
  return title.length > WEB_TAB_TITLE_MAX ? title.slice(0, WEB_TAB_TITLE_MAX) : title;
}

function blank(url: string): boolean {
  return url.trim() === '';
}

export function normalizeLayout(layout: WebTabsLayout): WebTabsLayout {
  const tabs: WebTab[] = [];
  const ids = new Set<string>();
  for (const tab of layout.tabs) {
    if (!ids.has(tab.id) && !blank(tab.url)) {
      ids.add(tab.id);
      tabs.push(tab.title.length > WEB_TAB_TITLE_MAX ? { ...tab, title: clip(tab.title) } : tab);
    }
  }
  const seen = new Set<string>();
  const keep = (list: readonly string[]): string[] => list.filter((id) => {
    if (!ids.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  const pinned = keep(layout.pinned);
  const groupIds = new Set<string>();
  const groups = layout.groups.filter((group) => {
    if (groupIds.has(group.id)) {
      return false;
    }
    groupIds.add(group.id);
    return true;
  }).map((group) => ({ ...group, tabIds: keep(group.tabIds) }));
  const today = keep(layout.today);
  const strays = tabs.filter((tab) => !seen.has(tab.id)).map((tab) => tab.id);
  const keys = new Set<string>();
  const archived = [...layout.archived].filter((entry) => {
    if (keys.has(entry.key) || blank(entry.url)) {
      return false;
    }
    keys.add(entry.key);
    return true;
  }).slice(0, WEB_TABS_ARCHIVED_MAX);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const allToday = [...strays, ...today];
  const ordered = [...pinned, ...groups.flatMap((group) => group.tabIds), ...allToday].map((id) => byId.get(id)!);
  return { tabs: ordered, pinned, groups, today: allToday, archived };
}

function placeOf(layout: WebTabsLayout, id: string): 'pinned' | 'today' | WebTabGroup | null {
  if (layout.pinned.includes(id)) return 'pinned';
  if (layout.today.includes(id)) return 'today';
  return layout.groups.find((group) => group.tabIds.includes(id)) ?? null;
}

export function mergeLayouts(base: WebTabsLayout, incoming: WebTabsLayout, newId: () => string): WebTabsLayout {
  const result = normalizeLayout(base);
  const urls = new Set(result.tabs.map((tab) => tab.url));
  const ids = new Set(result.tabs.map((tab) => tab.id));
  const groups = result.groups.map((group) => ({ ...group, tabIds: [...group.tabIds] }));
  const pinned = [...result.pinned];
  const today = [...result.today];
  const tabs = [...result.tabs];
  const source = normalizeLayout(incoming);
  for (const tab of source.tabs) {
    if (urls.has(tab.url)) {
      continue;
    }
    urls.add(tab.url);
    const id = ids.has(tab.id) ? newId() : tab.id;
    ids.add(id);
    tabs.push({ ...tab, id });
    const place = placeOf(source, tab.id);
    if (place === 'pinned') {
      pinned.push(id);
    } else if (place === 'today' || place === null) {
      today.push(id);
    } else {
      let group = groups.find((candidate) => candidate.name === place.name);
      if (group === undefined) {
        const groupId = groups.some((candidate) => candidate.id === place.id) ? `group-${newId()}` : place.id;
        group = { ...place, id: groupId, tabIds: [] };
        groups.push(group);
      }
      group.tabIds.push(id);
    }
  }
  const keys = new Set(result.archived.map((entry) => entry.key));
  const archived = [...result.archived, ...source.archived.filter((entry) => !keys.has(entry.key))]
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  return normalizeLayout({ tabs, pinned, groups, today, archived });
}

export function sameLayout(a: WebTabsLayout, b: WebTabsLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
