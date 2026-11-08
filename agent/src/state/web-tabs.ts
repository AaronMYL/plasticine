// 竖排网页标签的摆放（迁移 0109）：只做存取和版本。整份读、整份写——写的时候按 id 对行：新的插进去，还在的改，
// 不在摆放里的只记 removed_at（行留着，10-26 第 25 条）。要不要接受这一份（版本对不对、怎么合并）由 app/web-tabs.ts 定。

import { Value } from 'typebox/value';
import {
  WEB_TABS_ARCHIVED_MAX,
  WebTabsLayoutSchema,
  type ArchivedTab,
  type WebTab,
  type WebTabGroup,
  type WebTabsLayout,
} from '../../shared/api/web-tabs.ts';
import { mergeLayouts, normalizeLayout, sameLayout } from '../../shared/web-tabs-layout.ts';
import type { Database, Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface WebTabsSnapshot {
  layout: WebTabsLayout;
  version: number;
}

type Place = { place: 'pinned' | 'today' | 'group'; groupId: string | null; position: number };

function text(row: Row, column: string): string {
  return String(row[column]);
}

function liveIds(db: Database, table: string, key: string): Set<string> {
  return new Set(db.all(`SELECT ${key} AS id FROM ${table} WHERE removed_at IS NULL`).map((row) => text(row, 'id')));
}

function readLayout(db: Database): WebTabsLayout {
  const groups = db.all(`SELECT id, name, hue, collapsed FROM web_tab_groups WHERE removed_at IS NULL
    ORDER BY position, id`).map((row): WebTabGroup => ({ id: text(row, 'id'), name: text(row, 'name'),
    hue: text(row, 'hue') as WebTabGroup['hue'], collapsed: row['collapsed'] === 1, tabIds: [] }));
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  const tabs: WebTab[] = [];
  const pinned: string[] = [];
  const today: string[] = [];
  const rows = db.all(`SELECT * FROM web_tabs WHERE removed_at IS NULL ORDER BY position, id`);
  for (const row of rows) {
    const id = text(row, 'id');
    tabs.push({ id, kind: 'web', url: text(row, 'url'), title: text(row, 'title'),
      openedBy: text(row, 'opened_by') as WebTab['openedBy'], openedAt: text(row, 'opened_at'),
      visitedAt: text(row, 'visited_at') });
    const place = text(row, 'place');
    if (place === 'pinned') pinned.push(id);
    else if (place === 'group') byGroup.get(text(row, 'group_id'))?.tabIds.push(id);
    else today.push(id);
  }
  const archived = db.all(`SELECT key, url, title, closed_at FROM web_tabs_closed WHERE removed_at IS NULL
    ORDER BY closed_at DESC, key LIMIT ${WEB_TABS_ARCHIVED_MAX}`).map((row): ArchivedTab => ({
    key: text(row, 'key'), url: text(row, 'url'), title: text(row, 'title'), closedAt: text(row, 'closed_at') }));
  const layout = normalizeLayout({ tabs, pinned, groups, today, archived });
  if (!Value.Check(WebTabsLayoutSchema, layout)) {
    throw new StateError('corrupt_record', '竖排标签的摆放在库里读出来不对，没有用。');
  }
  return layout;
}

function places(layout: WebTabsLayout): Map<string, Place> {
  const result = new Map<string, Place>();
  layout.pinned.forEach((id, position) => result.set(id, { place: 'pinned', groupId: null, position }));
  layout.today.forEach((id, position) => result.set(id, { place: 'today', groupId: null, position }));
  for (const group of layout.groups) {
    group.tabIds.forEach((id, position) => result.set(id, { place: 'group', groupId: group.id, position }));
  }
  return result;
}

function writeLayout(db: Database, layout: WebTabsLayout, now: string): void {
  const where = places(layout);
  const liveTabs = liveIds(db, 'web_tabs', 'id');
  for (const tab of layout.tabs) {
    const at = where.get(tab.id) ?? { place: 'today', groupId: null, position: 0 };
    db.run(`INSERT INTO web_tabs (id, url, title, opened_by, opened_at, visited_at, place, group_id, position,
        created_at, updated_at, removed_at)
      VALUES ($id, $url, $title, $openedBy, $openedAt, $visitedAt, $place, $groupId, $position, $now, $now, NULL)
      ON CONFLICT (id) DO UPDATE SET url = excluded.url, title = excluded.title, opened_by = excluded.opened_by,
        opened_at = excluded.opened_at, visited_at = excluded.visited_at, place = excluded.place,
        group_id = excluded.group_id, position = excluded.position, updated_at = excluded.updated_at,
        removed_at = NULL`,
    { id: tab.id, url: tab.url, title: tab.title, openedBy: tab.openedBy, openedAt: tab.openedAt,
      visitedAt: tab.visitedAt, place: at.place, groupId: at.groupId, position: at.position, now });
    liveTabs.delete(tab.id);
  }
  for (const id of liveTabs) {
    db.run('UPDATE web_tabs SET removed_at = $now, updated_at = $now WHERE id = $id', { id, now });
  }
  const liveGroups = liveIds(db, 'web_tab_groups', 'id');
  layout.groups.forEach((group, position) => {
    db.run(`INSERT INTO web_tab_groups (id, name, hue, collapsed, position, created_at, updated_at, removed_at)
      VALUES ($id, $name, $hue, $collapsed, $position, $now, $now, NULL)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, hue = excluded.hue, collapsed = excluded.collapsed,
        position = excluded.position, updated_at = excluded.updated_at, removed_at = NULL`,
    { id: group.id, name: group.name, hue: group.hue, collapsed: group.collapsed ? 1 : 0, position, now });
    liveGroups.delete(group.id);
  });
  for (const id of liveGroups) {
    db.run('UPDATE web_tab_groups SET removed_at = $now, updated_at = $now WHERE id = $id', { id, now });
  }
  const liveClosed = liveIds(db, 'web_tabs_closed', 'key');
  for (const entry of layout.archived) {
    db.run(`INSERT INTO web_tabs_closed (key, url, title, closed_at, created_at, removed_at)
      VALUES ($key, $url, $title, $closedAt, $now, NULL)
      ON CONFLICT (key) DO UPDATE SET url = excluded.url, title = excluded.title, closed_at = excluded.closed_at,
        removed_at = NULL`,
    { key: entry.key, url: entry.url, title: entry.title, closedAt: entry.closedAt, now });
    liveClosed.delete(entry.key);
  }
  for (const key of liveClosed) {
    db.run('UPDATE web_tabs_closed SET removed_at = $now WHERE key = $key', { key, now });
  }
}

export function createWebTabsStore(context: StoreContext) {
  const { db } = context;
  const version = (): number => {
    const row = db.get('SELECT version FROM web_tab_layout WHERE id = 1');
    return typeof row?.['version'] === 'number' ? row['version'] : 0;
  };
  const save = (layout: WebTabsLayout): WebTabsSnapshot => {
    const current = readLayout(db);
    const next = normalizeLayout(layout);
    if (sameLayout(current, next)) {
      return { layout: current, version: version() };
    }
    const now = context.now();
    writeLayout(db, next, now);
    db.run(`INSERT INTO web_tab_layout (id, version, updated_at) VALUES (1, 1, $now)
      ON CONFLICT (id) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`, { now });
    return { layout: readLayout(db), version: version() };
  };
  return {
    read: (): WebTabsSnapshot => ({ layout: readLayout(db), version: version() }),
    /** 整份换成 layout；baseVersion 不是现在的版本就抛 version_conflict（带现在的版本）。一样的不加版本。 */
    write: (layout: WebTabsLayout, baseVersion: number): WebTabsSnapshot => {
      const currentVersion = version();
      if (baseVersion !== currentVersion) {
        throw new StateError('version_conflict', '竖排标签在别的设备上改过了。', { currentVersion });
      }
      return save(layout);
    },
    /** 把某台设备上还没搬上来的一份并进来（同一个网址已经有了的跳过）。 */
    merge: (layout: WebTabsLayout): WebTabsSnapshot => save(mergeLayouts(readLayout(db), layout,
      () => context.newId())),
  };
}

export type WebTabsStateStore = ReturnType<typeof createWebTabsStore>;
