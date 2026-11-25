import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmarkStore } from '../../src/state/bookmarks.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { createFeedItemStore } from '../../src/state/feed-items.ts';
import { createFeedSourceStore } from '../../src/state/feed-sources.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { steppingClock } from './helpers.ts';

const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059' || entry.id === '0138-feed-places-body'
  || entry.id === '0140-feed-more-images');

const REMOVED_AT = '2026-11-03T12:00:00.000Z';

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

test('0051 moves starred feed out of bookmarks and restores cascade-unstarred items', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    const columns = (id: string): boolean => id === '0054-feed-sources-x' || id === '0138-feed-places-body'
      || id === '0140-feed-more-images';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0045' || columns(entry.id)), now);
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
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0051' || columns(entry.id)), now);
    const bookmarks = createBookmarkStore(context);

    removeBookmark(db, `bm_feed_${pageRemoved.id}`);
    unsave(db, pageRemoved.id);
    receipt(db, `POST /v2/bookmarks/bm_feed_${pageRemoved.id}/remove`);
    unsave(db, feedUnsaved.id);
    removeBookmark(db, `bm_feed_${feedUnsaved.id}`);
    receipt(db, `POST /v2/feed/items/${feedUnsaved.id}/save`);
    const fresh = bookmarks.create({ kind: 'web', title: '条目 later', target: 'https://example.com/later',
      origin: 'feed', feedItemId: later.id, position: 9 });
    removeBookmark(db, fresh.id);
    receipt(db, `POST /v2/bookmarks/${fresh.id}/remove`);
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
