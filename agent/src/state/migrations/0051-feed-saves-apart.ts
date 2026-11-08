// 2026-11-04 用户定：信息流收藏归信息流、网页收藏归书签，两边分开（收藏不再同时加书签，书签页移除也不再取消收藏）。
// 0045 把收藏着的信息流条目各搬成一条 origin = feed 的书签（bm_feed_<条目 id>），之后信息流的收藏和书签一直双向同步。
// 这里把它们分回去，只改不删（10-26 第 25 条）：
// 1. 收藏补回：0045 之后在书签页删掉信息流书签时，服务端连带清了那一条的 saved_at——这是「分开」以后不该有的结果。
//    认法：这一条最后被删的那条书签（按删除时间）在接口回执里有书签页的移除（POST /v2/bookmarks/<书签 id>/remove）。
//    在信息流里自己取消收藏的，删书签是连带的、没有这条回执，不补；之后又在信息流里收藏过的，saved_at 本来就有值。
//    补回的时间用那条书签的建立时间：0045 搬来的就是原来的收藏时间（created_at = saved_at），之后加的就是收藏那一刻。
//    还在用、却对着没收藏条目的信息流书签（启动核对会报的那种）同样按书签的建立时间补回收藏。
// 2. 书签里移走：还在用的信息流书签（origin = feed，或带着 feed_item_id）只写 deleted_at，行和 feed_item_id 都留着。

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
