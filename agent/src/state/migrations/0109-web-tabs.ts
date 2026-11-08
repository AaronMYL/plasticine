// 竖排网页标签存进本体（《优化清单》第 2 条；11-08 他定每台设备看到同一份）。只加表，旧的 bookmarks 表一行不动：
// - web_tab_layout：只有一行，摆放的版本（每写一次加一）；设备按它判断自己手上的是不是最新的。
// - web_tabs：标签（网址、标题、谁开的、时间）和它在哪（置顶 / 某一组 / 今天）、第几个；不在摆放里了只记 removed_at。
// - web_tab_groups：分组（名字、颜色、收没收起）和先后；解散了只记 removed_at。
// - web_tabs_closed：「关掉的」（⌘K 找得回、点了重开）；不再列的只记 removed_at。
// 书签在这里搬一次（原来是每台设备第一次读到书签时各自搬，11-07 shell 线）：网页书签进「书签」一组（收起），保存的分组
// 各成一组；信息流的收藏、Plasticine 自己的页面不搬，同一个网址只搬一次。种类、颜色只用 shared 的 schema 检查。

import type { Migration, MigrationDb } from './migrate.ts';

const TABLES = [
  `CREATE TABLE web_tab_layout (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    version INTEGER NOT NULL CHECK (version >= 0),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE web_tabs (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    visited_at TEXT NOT NULL,
    place TEXT NOT NULL CHECK (place IN ('pinned', 'group', 'today')),
    group_id TEXT,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT,
    CHECK ((place = 'group') = (group_id IS NOT NULL))
  )`,
  'CREATE INDEX web_tabs_live ON web_tabs (removed_at, place, group_id, position)',
  `CREATE TABLE web_tab_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    hue TEXT NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT
  )`,
  `CREATE TABLE web_tabs_closed (
    key TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    closed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    removed_at TEXT
  )`,
  'CREATE INDEX web_tabs_closed_live ON web_tabs_closed (removed_at, closed_at)',
];

/** 和 shared/api/project-tag.ts 的 PROJECT_HUES 同一份先后（迁移是历史，写死在这里）。 */
const HUES = ['ochre', 'teal', 'sky', 'rose', 'olive', 'slate'];
const BOOKMARKS_GROUP_ID = 'wtg-bookmarks';
const BOOKMARKS_GROUP_NAME = '书签';
const TITLE_MAX = 500;

interface Planned {
  id: string;
  url: string;
  title: string;
  at: string;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return /^https?:\/\//i.test(value) ? value : null;
}

function savedTabs(raw: unknown): { title: string; target: string }[] {
  if (typeof raw !== 'string') {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const tab = entry as Record<string, unknown>;
    if (tab['kind'] !== 'web' || typeof tab['target'] !== 'string') return [];
    return [{ title: typeof tab['title'] === 'string' ? tab['title'] : '', target: tab['target'] }];
  });
}

function moveBookmarks(db: MigrationDb, now: string): boolean {
  const rows = db.all(`SELECT id, kind, title, target, tabs, created_at FROM bookmarks
    WHERE deleted_at IS NULL AND origin <> 'feed' ORDER BY position, created_at, id`);
  const seen = new Set<string>();
  const take = (id: string, url: string | null, title: string, at: string): Planned | null => {
    if (url === null || seen.has(url)) return null;
    seen.add(url);
    return { id, url, title: title.slice(0, TITLE_MAX), at };
  };
  const loose: Planned[] = [];
  const saved: { id: string; name: string; tabs: Planned[] }[] = [];
  for (const row of rows) {
    const id = String(row['id']);
    const at = String(row['created_at']);
    if (row['kind'] === 'web') {
      const tab = take(`wt-bm-${id}`, webUrl(row['target']), String(row['title']), at);
      if (tab !== null) loose.push(tab);
    } else if (row['kind'] === 'group') {
      const tabs = savedTabs(row['tabs']).flatMap((entry, index) =>
        take(`wt-bm-${id}-${index}`, webUrl(entry.target), entry.title, at) ?? []);
      if (tabs.length > 0) saved.push({ id: `wtg-bm-${id}`, name: String(row['title']), tabs });
    }
  }
  const groups = [
    ...(loose.length > 0 ? [{ id: BOOKMARKS_GROUP_ID, name: BOOKMARKS_GROUP_NAME, tabs: loose }] : []),
    ...saved,
  ];
  groups.forEach((group, groupIndex) => {
    db.run(`INSERT INTO web_tab_groups (id, name, hue, collapsed, position, created_at, updated_at, removed_at)
      VALUES ($id, $name, $hue, 1, $position, $now, $now, NULL)`,
    { id: group.id, name: group.name.slice(0, TITLE_MAX), hue: HUES[groupIndex % HUES.length]!,
      position: groupIndex, now });
    group.tabs.forEach((tab, position) => {
      db.run(`INSERT INTO web_tabs (id, url, title, opened_by, opened_at, visited_at, place, group_id, position,
          created_at, updated_at, removed_at)
        VALUES ($id, $url, $title, 'user', $at, $at, 'group', $group, $position, $now, $now, NULL)`,
      { id: tab.id, url: tab.url, title: tab.title, at: tab.at, group: group.id, position, now });
    });
  });
  return groups.length > 0;
}

export const migration: Migration = {
  id: '0109-web-tabs',
  up(db) {
    for (const statement of TABLES) {
      db.exec(statement);
    }
    const now = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    const moved = moveBookmarks(db, now);
    db.run('INSERT INTO web_tab_layout (id, version, updated_at) VALUES (1, $version, $now)',
      { version: moved ? 1 : 0, now });
  },
};
