// 迁移 0051（2026-11-04 用户定：信息流收藏归信息流、网页收藏归书签，两边分开）：
// - 0045 搬进书签的信息流收藏（origin = feed，含 bm_feed_*）从书签里移走：只写 deleted_at，行不删；
// - 0045 之后在书签页删掉信息流书签、连带清了 saved_at 的，按「最后那条被删的书签是从书签页删的」认出来，把 saved_at 补回；
//   在信息流里自己取消收藏的不补；手加的、导入的书签不动；再跑一遍不重复。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmarkStore } from '../../src/state/bookmarks.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { createFeedItemStore } from '../../src/state/feed-items.ts';
import { createFeedSourceStore } from '../../src/state/feed-sources.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { steppingClock } from './helpers.ts';

// 讲的是 0058 之前的历史：只跑到 0058（0059 起的清理在 retire-migration.test.ts）。
const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

const REMOVED_AT = '2026-11-03T12:00:00.000Z';

/** 接口回执里只看 scope：书签页的移除是 POST /v2/bookmarks/<id>/remove，信息流的收藏开关是 POST /v2/feed/items/<id>/save。 */
function receipt(db: Database, scope: string): void {
  db.run(`INSERT INTO api_requests (request_id, scope, device_id, status, body, created_at, expires_at)
    VALUES ($id, $scope, NULL, 200, '{}', $at, $at)`, { id: `req-${scope}`, scope, at: REMOVED_AT });
}

function removeBookmark(db: Database, id: string, at = REMOVED_AT): void {
  db.run('UPDATE bookmarks SET deleted_at = $at, version = version + 1 WHERE id = $id', { id, at });
}

function unsave(db: Database, itemId: string): void {
  db.run('UPDATE feed_items SET saved_at = NULL, version = version + 1 WHERE id = $id', { id: itemId });
}

test('0051：信息流收藏从书签移走（只记删除时间）；书签页删掉连带取消的收藏补回，信息流里自己取消的不补', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    // 条目用现在的存储写进去：它要 0054 加的作者、配图列，先把 0054 一起跑上（只加列，和 0045–0051 不相干）。
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0045' || entry.id === '0054-feed-sources-x'), now);
    let n = 0;
    const context: StoreContext = { db, now, newId: () => `id-${(n += 1)}` };
    const sources = createFeedSourceStore(context);
    const items = createFeedItemStore(context);
    const source = sources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加', level: 'normal' });
    const add = (key: string, savedAt: string | null) => {
      const { item } = items.add({ sourceId: source.id, origin: 'manual', title: `条目 ${key}`,
        url: `https://example.com/${key}`, dedupeKey: key, day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z' });
      return savedAt === null ? item : items.update(item.id, item.version, { savedAt });
    };
    const kept = add('kept', '2026-10-28T01:00:00.000Z');
    const pageRemoved = add('page', '2026-10-28T02:00:00.000Z');
    const feedUnsaved = add('feed', '2026-10-28T03:00:00.000Z');
    const later = add('later', null);
    const back = add('back', '2026-10-28T04:00:00.000Z');
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0051' || entry.id === '0054-feed-sources-x'), now);
    const bookmarks = createBookmarkStore(context);

    // 0045 之后：书签页删掉一条（服务端连带清了收藏）；信息流里取消一条（服务端连带删了书签）。
    removeBookmark(db, `bm_feed_${pageRemoved.id}`);
    unsave(db, pageRemoved.id);
    receipt(db, `POST /v2/bookmarks/bm_feed_${pageRemoved.id}/remove`);
    unsave(db, feedUnsaved.id);
    removeBookmark(db, `bm_feed_${feedUnsaved.id}`);
    receipt(db, `POST /v2/feed/items/${feedUnsaved.id}/save`);
    // 0045 之后才在信息流收藏、又在书签页删掉的。
    const fresh = bookmarks.create({ kind: 'web', title: '条目 later', target: 'https://example.com/later',
      origin: 'feed', feedItemId: later.id, position: 9 });
    removeBookmark(db, fresh.id);
    receipt(db, `POST /v2/bookmarks/${fresh.id}/remove`);
    // 先在书签页删掉，后来又在信息流收藏、再取消：最后一次是信息流里取消的，不补。
    removeBookmark(db, `bm_feed_${back.id}`, '2026-11-03T10:00:00.000Z');
    receipt(db, `POST /v2/bookmarks/bm_feed_${back.id}/remove`);
    const again = bookmarks.create({ kind: 'web', title: '条目 back', target: 'https://example.com/back',
      origin: 'feed', feedItemId: back.id, position: 10 });
    removeBookmark(db, again.id, '2026-11-03T11:00:00.000Z');
    unsave(db, back.id);
    const manual = bookmarks.create({ kind: 'web', title: '手加的', target: 'https://example.com/manual',
      origin: 'manual', position: 11 });
    const imported = bookmarks.create({ kind: 'web', title: '导入的', target: 'https://example.com/import',
      origin: 'import', position: 12 });
    const bookmarkRows = db.all('SELECT count(*) AS n FROM bookmarks')[0]?.['n'];
    const itemRows = db.all('SELECT count(*) AS n FROM feed_items')[0]?.['n'];

    assert.deepEqual(migrate(db, MIGRATIONS, now), ['0051-feed-saves-apart', '0052-mail-bodies',
      '0053-reminder-notices', '0055-self-expectations', '0057-ask-basis', '0058-lines']);
    assert.deepEqual(bookmarks.live().map((row) => row.id), [manual.id, imported.id], '书签里只剩手加的和导入的');
    const moved = bookmarks.require(`bm_feed_${kept.id}`);
    assert.ok(moved.deletedAt !== null, '搬进书签的信息流收藏只记删除时间');
    assert.equal(moved.version, 2);
    assert.equal(items.require(kept.id).savedAt, '2026-10-28T01:00:00.000Z', '一直收藏着的不动');
    assert.equal(items.require(pageRemoved.id).savedAt, '2026-10-28T02:00:00.000Z', '书签页删掉的补回原来的收藏时间');
    assert.equal(items.require(later.id).savedAt, fresh.createdAt, '0045 之后收藏、书签页删掉的也补回');
    assert.equal(items.require(feedUnsaved.id).savedAt, null, '信息流里自己取消的不补');
    assert.equal(items.require(back.id).savedAt, null, '最后一次是在信息流里取消的不补');
    assert.equal(db.all('SELECT count(*) AS n FROM bookmarks')[0]?.['n'], bookmarkRows, '书签一行不少');
    assert.equal(db.all('SELECT count(*) AS n FROM feed_items')[0]?.['n'], itemRows, '信息流一行不少');
    assert.deepEqual(migrate(db, MIGRATIONS, now), []);
  } finally {
    db.close();
  }
});
