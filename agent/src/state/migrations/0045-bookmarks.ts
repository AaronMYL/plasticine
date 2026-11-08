// 书签（2026-11-03 用户定，第 110 条）。只加表（10-26 第 25 条），旧行一条不动：
// - bookmarks：网页 / 页面 / 保存的分组，项目可空，正文快照，来源（手加 / 信息流 / 导入），排序；删除只记 deleted_at。
// - 信息流的收藏并进书签：已收藏的条目（feed_items.saved_at 有值）各迁成一条 origin = feed 的书签，标识固定为
//   bm_feed_<条目 id>，项目跟着条目所在的项目走（条目 → 关切 → project_items）。迁移只跑一次（schema_migrations），
//   启动时再按同一口径核对一遍（daily/bookmarks.ts checkFeedBookmarks），对不上只报告不悄悄修。
// 种类、来源只用 shared 的 schema 检查，这里不写 CHECK 列表，以后加档不用改表。

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

// 正文快照取条目的摘要（信息流没有存整页正文）；没有网址的条目是 Plasticine 自己的一页（#/feed/<id>）。
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
    // 一条信息流条目只对应一条在用的书签（取消收藏后再收藏是新的一条）。
    db.exec(`CREATE UNIQUE INDEX bookmarks_feed_item ON bookmarks (feed_item_id)
      WHERE feed_item_id IS NOT NULL AND deleted_at IS NULL`);
    db.exec(SAVED_FEED);
  },
};
