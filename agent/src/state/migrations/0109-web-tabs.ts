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
