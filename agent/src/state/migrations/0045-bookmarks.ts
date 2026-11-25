import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

const BOOKMARKS = `CREATE TABLE bookmarks (${RECORD_COLUMNS},
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  target TEXT,
  project_id TEXT REFERENCES projects (id),
  ${jsonColumn('tabs', false)},
  snapshot TEXT,
  snapshot_chars INTEGER NOT NULL DEFAULT 0 CHECK (snapshot_chars >= 0),
  origin TEXT NOT NULL,
  feed_item_id TEXT REFERENCES feed_items (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  deleted_at TEXT
)`;

const SAVED_FEED = `INSERT INTO bookmarks (id, created_at, updated_at, version, kind, title, target, project_id, tabs,
    snapshot, snapshot_chars, origin, feed_item_id, position, deleted_at)
  SELECT 'bm_feed_' || f.id, f.saved_at, f.saved_at, 1,
    CASE WHEN f.url IS NULL THEN 'page' ELSE 'web' END,
    CASE WHEN length(trim(f.title)) = 0 THEN coalesce(f.url, '信息流的一条') ELSE substr(f.title, 1, 500) END,
    coalesce(f.url, '#/feed/' || f.id),
    (SELECT pi.project_id FROM project_items pi WHERE pi.target_type = 'concern' AND pi.target_id = f.concern_id),
    '[]',
    CASE WHEN length(f.summary) = 0 THEN NULL ELSE f.summary END,
    length(f.summary),
    'feed', f.id,
    row_number() OVER (ORDER BY f.saved_at, f.id) - 1,
    NULL
  FROM feed_items f WHERE f.saved_at IS NOT NULL`;

export const migration: Migration = {
  id: '0045-bookmarks',
  up(db) {
    db.exec(BOOKMARKS);
    db.exec('CREATE INDEX bookmarks_live ON bookmarks (deleted_at, project_id, position)');
    db.exec(`CREATE UNIQUE INDEX bookmarks_feed_item ON bookmarks (feed_item_id)
      WHERE feed_item_id IS NOT NULL AND deleted_at IS NULL`);
    db.exec(SAVED_FEED);
  },
};
