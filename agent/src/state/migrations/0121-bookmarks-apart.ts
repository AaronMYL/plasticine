// 书签和标签分开（第 8 批第 1 条，11-09 他定：「书签里面是我存的网站地址，标签页是我现在打开的这些网站」）。
// 0109 把网页书签搬成了「书签」一组标签（wtg-bookmarks），点了在原地浏览；书签表一行没动。这里把这一组拆回去：
// - 组里每个标签：对应的书签（0109 搬的是 wt-bm-<书签 id>）还在就以书签表里原来的网址为准；后来收进组里的按标签的
//   网址和标题加成书签（bm_tab_<标签 id>）；同一个网址（规整后）已经有书签的不再加。
// - 被浏览到别的网址的标签（书签管不到那一页）：那一页进「关掉的」，⌘K 还找得回。
// - 书签的先后照组里的先后（他最后看到的样子），别的书签接在后面、相互顺序不变；位置变了的版本加一。
// - 组和组里的标签只记 removed_at（行留着）；摆放版本加一，各设备读到新的摆放。
// - 新加的书签行是直接写的，查找索引不知道：把书签的回填版本记成 0，下次打开库时整类重填（回填是按行覆盖的）。
// 网址规整照 shared/bookmarks.ts 当时的 bookmarkKey 写死在这里（迁移是历史，不跟着以后改）。

import type { Migration, MigrationDb } from './migrate.ts';

const GROUP_ID = 'wtg-bookmarks';
const TAB_BOOKMARK_PREFIX = 'wt-bm-';
const NEW_BOOKMARK_PREFIX = 'bm_tab_';
const TITLE_MAX = 500;

interface GroupTab {
  id: string;
  url: string;
  title: string;
  /** 0109 搬来的那条书签（还在用的）；后来收进组的是 null。 */
  bookmark: { id: string; target: string } | null;
}

interface LiveBookmark {
  id: string;
  kind: string;
  target: string | null;
  position: number;
}

/** 同一个网页的键：主机名小写、去掉末尾的 #（0045 起 bookmarkKey 的口径）。 */
function webKey(url: string): string {
  try {
    const href = new URL(url).href;
    return href.endsWith('#') ? href.slice(0, -1) : href;
  } catch {
    // 解析不了按原文比较。不记日志：网址里可能带口令。
    return url;
  }
}

/** 加成书签的网址：只收 http(s)，去掉账号密码（和加书签时一样）；收不了是 null。 */
function bookmarkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // 不是完整的网址：不加成书签，标签照样移走（原文不进日志）。
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

/** 浏览到别处的那一页进「关掉的」（key 和界面关标签时同一个样子：<标签 id>@<时间>）。 */
function keepBrowsed(db: MigrationDb, tab: GroupTab, now: string): void {
  db.run(`INSERT INTO web_tabs_closed (key, url, title, closed_at, created_at, removed_at)
    VALUES ($key, $url, $title, $now, $now, NULL) ON CONFLICT (key) DO NOTHING`,
  { key: `${tab.id}@${now}`, url: tab.url, title: tab.title, now });
}

/** 组里的先后排在最前，别的接在后面；位置变了的才改（原有的版本加一，这次新加的还是第 1 版）。 */
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
