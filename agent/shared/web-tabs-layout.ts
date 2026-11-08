// 竖排标签的摆放规整与合并（两端共用：服务端存之前规整一遍，客户端读回来、合并旧存档时用同一套）。
// · 每个标签恰好在一处（置顶、某一组、今天）；对不上的放进今天，不丢；重复的只留第一处。
// · 合并：把一份还没搬上来的摆放并进现有的——同一个网址已经有标签的不再加；进同名的组（没有就新建一组）；
//   「关掉的」按时间并起来，最多留 WEB_TABS_ARCHIVED_MAX 条。

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

/** 每个标签恰好在一处；没有摆放的标签放进今天最上面；同一个 id 的标签只留第一个；标签按竖排的先后排。 */
export function normalizeLayout(layout: WebTabsLayout): WebTabsLayout {
  const tabs: WebTab[] = [];
  const ids = new Set<string>();
  for (const tab of layout.tabs) {
    if (!ids.has(tab.id)) {
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
    if (keys.has(entry.key)) {
      return false;
    }
    keys.add(entry.key);
    return true;
  }).slice(0, WEB_TABS_ARCHIVED_MAX);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const allToday = [...strays, ...today];
  // 标签按竖排的先后排（置顶、各组、今天）：同一份摆放只有一种写法，两端比较「变没变」不会被先后骗。
  const ordered = [...pinned, ...groups.flatMap((group) => group.tabIds), ...allToday].map((id) => byId.get(id)!);
  return { tabs: ordered, pinned, groups, today: allToday, archived };
}

function placeOf(layout: WebTabsLayout, id: string): 'pinned' | 'today' | WebTabGroup | null {
  if (layout.pinned.includes(id)) return 'pinned';
  if (layout.today.includes(id)) return 'today';
  return layout.groups.find((group) => group.tabIds.includes(id)) ?? null;
}

/**
 * 把 incoming 并进 base（base 优先）：网址已经有了的标签跳过；标签 id 撞了但网址不同的换一个 id（newId）。
 * 组按名字对上；对不上的整组带过来（组 id 撞了也换）。返回规整过的新摆放。
 */
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

/** 两份摆放是不是一样（按内容，不按对象身份）。 */
export function sameLayout(a: WebTabsLayout, b: WebTabsLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
