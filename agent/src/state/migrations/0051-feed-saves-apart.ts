import type { Migration } from './migrate.ts';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const FEED_BOOKMARK = "(origin = 'feed' OR feed_item_id IS NOT NULL)";

const RESTORE_FROM_PAGE_REMOVAL = `WITH last_removed AS (
    SELECT feed_item_id AS item_id, id AS bookmark_id, created_at AS saved_at,
      row_number() OVER (PARTITION BY feed_item_id ORDER BY deleted_at DESC, created_at DESC, id DESC) AS recency
    FROM bookmarks WHERE feed_item_id IS NOT NULL AND deleted_at IS NOT NULL
  ), restored AS (
    SELECT item_id, saved_at FROM last_removed
    WHERE recency = 1 AND EXISTS (SELECT 1 FROM api_requests
      WHERE scope = 'POST /v2/bookmarks/' || last_removed.bookmark_id || '/remove' AND status BETWEEN 200 AND 299)
  )
  UPDATE feed_items SET
    saved_at = (SELECT saved_at FROM restored WHERE restored.item_id = feed_items.id),
    updated_at = ${NOW},
    version = version + 1
  WHERE saved_at IS NULL AND id IN (SELECT item_id FROM restored)
    AND NOT EXISTS (SELECT 1 FROM bookmarks live
      WHERE live.feed_item_id = feed_items.id AND live.deleted_at IS NULL)`;

const RESTORE_FROM_LIVE = `UPDATE feed_items SET
    saved_at = (SELECT min(created_at) FROM bookmarks live
      WHERE live.feed_item_id = feed_items.id AND live.deleted_at IS NULL),
    updated_at = ${NOW},
    version = version + 1
  WHERE saved_at IS NULL AND EXISTS (SELECT 1 FROM bookmarks live
    WHERE live.feed_item_id = feed_items.id AND live.deleted_at IS NULL)`;

const MOVE_OUT = `UPDATE bookmarks SET
    deleted_at = ${NOW},
    updated_at = ${NOW},
    version = version + 1
  WHERE deleted_at IS NULL AND ${FEED_BOOKMARK}`;

export const migration: Migration = {
  id: '0051-feed-saves-apart',
  up(db) {
    db.exec(RESTORE_FROM_PAGE_REMOVAL);
    db.exec(RESTORE_FROM_LIVE);
    db.exec(MOVE_OUT);
  },
};
