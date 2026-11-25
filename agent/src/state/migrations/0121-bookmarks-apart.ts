import type { Migration, MigrationDb } from './migrate.ts';

const GROUP_ID = 'wtg-bookmarks';
const TAB_BOOKMARK_PREFIX = 'wt-bm-';
const NEW_BOOKMARK_PREFIX = 'bm_tab_';
const TITLE_MAX = 500;

interface GroupTab {
  id: string;
  url: string;
  title: string;
  bookmark: { id: string; target: string } | null;
}

interface LiveBookmark {
  id: string;
  kind: string;
  target: string | null;
  position: number;
}

function webKey(url: string): string {
  try {
    const href = new URL(url).href;
    return href.endsWith('#') ? href.slice(0, -1) : href;
  } catch {
    return url;
  }
}

function bookmarkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  url.username = '';
  url.password = '';
  return url.toString();
}

function groupTabs(db: MigrationDb): GroupTab[] {
  return db.all(`SELECT t.id, t.url, t.title, b.id AS bookmark_id, b.target AS bookmark_target
    FROM web_tabs t LEFT JOIN bookmarks b
      ON b.id = substr(t.id, ${TAB_BOOKMARK_PREFIX.length + 1}) AND b.deleted_at IS NULL AND b.kind = 'web'
        AND b.target IS NOT NULL AND t.id LIKE '${TAB_BOOKMARK_PREFIX}%'
    WHERE t.group_id = $group AND t.removed_at IS NULL
    ORDER BY t.position, t.id`, { group: GROUP_ID }).map((row) => ({
    id: String(row['id']),
    url: String(row['url']),
    title: String(row['title']),
    bookmark: row['bookmark_id'] === null ? null
      : { id: String(row['bookmark_id']), target: String(row['bookmark_target']) },
  }));
}

function liveBookmarks(db: MigrationDb): LiveBookmark[] {
  return db.all(`SELECT id, kind, target, position FROM bookmarks WHERE deleted_at IS NULL
    ORDER BY position, created_at, id`).map((row) => ({ id: String(row['id']), kind: String(row['kind']),
      target: row['target'] === null ? null : String(row['target']), position: Number(row['position']) }));
}

function addBookmark(db: MigrationDb, tab: GroupTab, url: string, now: string): string {
  const id = `${NEW_BOOKMARK_PREFIX}${tab.id}`;
  const title = (tab.title.trim() === '' ? url : tab.title.trim()).slice(0, TITLE_MAX);
  const top = Number(db.all('SELECT coalesce(max(position), -1) AS top FROM bookmarks')[0]?.['top'] ?? -1);
  db.run(`INSERT INTO bookmarks (id, created_at, updated_at, version, kind, title, target, project_id, tabs, snapshot,
      snapshot_chars, origin, feed_item_id, position, deleted_at)
    VALUES ($id, $now, $now, 1, 'web', $title, $url, NULL, '[]', NULL, 0, 'manual', NULL, $position, NULL)`,
  { id, now, title, url, position: top + 1 });
  return id;
}

function keepBrowsed(db: MigrationDb, tab: GroupTab, now: string): void {
  db.run(`INSERT INTO web_tabs_closed (key, url, title, closed_at, created_at, removed_at)
    VALUES ($key, $url, $title, $now, $now, NULL) ON CONFLICT (key) DO NOTHING`,
  { key: `${tab.id}@${now}`, url: tab.url, title: tab.title, now });
}

function reorder(db: MigrationDb, first: readonly string[], added: ReadonlySet<string>, now: string): void {
  const live = liveBookmarks(db);
  const rest = live.map((row) => row.id).filter((id) => !first.includes(id));
  const positions = new Map(live.map((row) => [row.id, row.position]));
  [...first, ...rest].forEach((id, position) => {
    if (positions.get(id) !== position) {
      const bump = added.has(id) ? 0 : 1;
      db.run(`UPDATE bookmarks SET position = $position, updated_at = $now, version = version + $bump
        WHERE id = $id`, { id, position, now, bump });
    }
  });
}

export const migration: Migration = {
  id: '0121-bookmarks-apart',
  up(db) {
    const group = db.all('SELECT id FROM web_tab_groups WHERE id = $id AND removed_at IS NULL', { id: GROUP_ID });
    if (group.length === 0) {
      return;
    }
    const now = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    const order: string[] = [];
    const added = new Set<string>();
    for (const tab of groupTabs(db)) {
      const url = tab.bookmark?.target ?? bookmarkUrl(tab.url);
      if (url === null) {
        continue;
      }
      const key = webKey(url);
      const known = tab.bookmark?.id ?? liveBookmarks(db)
        .find((row) => row.kind === 'web' && row.target !== null && webKey(row.target) === key)?.id;
      const id = known ?? addBookmark(db, tab, url, now);
      if (known === undefined) {
        added.add(id);
      }
      if (!order.includes(id)) {
        order.push(id);
      }
      if (tab.bookmark !== null && webKey(tab.url) !== key) {
        keepBrowsed(db, tab, now);
      }
    }
    reorder(db, order, added, now);
    db.run(`UPDATE web_tabs SET removed_at = $now, updated_at = $now
      WHERE group_id = $group AND removed_at IS NULL`, { group: GROUP_ID, now });
    db.run('UPDATE web_tab_groups SET removed_at = $now, updated_at = $now WHERE id = $group',
      { group: GROUP_ID, now });
    db.run(`INSERT INTO web_tab_layout (id, version, updated_at) VALUES (1, 1, $now)
      ON CONFLICT (id) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`, { now });
    db.run("UPDATE search_sources SET version = 0 WHERE source = 'bookmark'");
  },
};
