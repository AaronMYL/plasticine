import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmarkStore } from '../../src/state/bookmarks.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { createWebTabsStore } from '../../src/state/web-tabs.ts';
import { steppingClock } from './helpers.ts';

const ID = '0121-bookmarks-apart';

function contextOf(db: Database): StoreContext {
  let next = 0;
  return { db, now: steppingClock(), newId: () => `id-${(next += 1)}` };
}

function bookmark(db: Database, id: string, fields: { kind: string; title: string; target: string | null;
  position: number; origin?: string; deleted?: boolean }): void {
  db.run(`INSERT INTO bookmarks (id, created_at, updated_at, version, kind, title, target, project_id, tabs, snapshot,
      snapshot_chars, origin, feed_item_id, position, deleted_at)
    VALUES ($id, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z', 1, $kind, $title, $target, NULL, '[]', NULL,
      0, $origin, NULL, $position, $deleted)`,
  { id, kind: fields.kind, title: fields.title, target: fields.target, origin: fields.origin ?? 'manual',
    position: fields.position, deleted: fields.deleted === true ? '2026-11-04T00:00:00.000Z' : null });
}

function groupTab(db: Database, id: string, url: string, title: string, position: number): void {
  db.run(`INSERT INTO web_tabs (id, url, title, opened_by, opened_at, visited_at, place, group_id, position, created_at,
      updated_at, removed_at)
    VALUES ($id, $url, $title, 'user', '2026-11-08T02:00:00.000Z', '2026-11-08T02:00:00.000Z', 'group',
      'wtg-bookmarks', $position, '2026-11-08T02:00:00.000Z', '2026-11-08T02:00:00.000Z', NULL)`,
  { id, url, title, position });
}

function layoutVersion(db: Database): number {
  return Number(db.all('SELECT version FROM web_tab_layout WHERE id = 1')[0]?.['version']);
}

function beforeApart(): Database {
  const db = openDatabase(MEMORY_DATABASE);
  const clock = steppingClock();
  migrate(db, MIGRATIONS.filter((migration) => migration.id < '0109'), clock);
  bookmark(db, 'b1', { kind: 'web', title: 'AI Fluency', target: 'https://anthropic.skilljar.com/ai-fluency',
    position: 0 });
  bookmark(db, 'b2', { kind: 'web', title: 'X', target: 'https://x.com/home', position: 1 });
  bookmark(db, 'b3', { kind: 'page', title: '一篇笔记', target: '#/notes/n1', position: 2 });
  bookmark(db, 'b4', { kind: 'web', title: 'GitHub', target: 'https://github.com/', position: 3 });
  bookmark(db, 'b5', { kind: 'web', title: '收藏的一条', target: 'https://feed.example.com/a', origin: 'feed',
    position: 4, deleted: true });
  migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), clock);
  return db;
}

test('Migration 0121 is registered and non-destructive', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('Splits Bookmarks group back to bookmarks in order without dupes; marks removed', () => {
  const db = beforeApart();
  try {
    db.run(`UPDATE web_tabs SET url = 'https://x.com/someone/status/1', title = '某人的帖子', position = 0
      WHERE id = 'wt-bm-b2'`);
    db.run("UPDATE web_tabs SET position = 1 WHERE id = 'wt-bm-b1'");
    db.run("UPDATE web_tabs SET place = 'today', group_id = NULL, position = 0 WHERE id = 'wt-bm-b4'");
    groupTab(db, 'web-new-1', 'https://www.xiaohongshu.com/explore', '小红书', 2);
    groupTab(db, 'web-new-2', 'https://anthropic.skilljar.com/ai-fluency#', 'AI Fluency 又一个', 3);
    db.run("UPDATE web_tab_layout SET version = 5 WHERE id = 1");
    const otherGroup = db.all("SELECT count(*) AS n FROM web_tab_groups WHERE removed_at IS NULL")[0]?.['n'];
    assert.equal(otherGroup, 1);

    assert.deepEqual(migrate(db, MIGRATIONS.filter((migration) => migration.id <= ID), steppingClock()), [ID]);

    const bookmarks = createBookmarkStore(contextOf(db));
    assert.deepEqual(bookmarks.live().map((row) => [row.id, row.kind, row.title, row.target, row.position]), [
      ['b2', 'web', 'X', 'https://x.com/home', 0],
      ['b1', 'web', 'AI Fluency', 'https://anthropic.skilljar.com/ai-fluency', 1],
      ['bm_tab_web-new-1', 'web', '小红书', 'https://www.xiaohongshu.com/explore', 2],
      ['b3', 'page', '一篇笔记', '#/notes/n1', 3],
      ['b4', 'web', 'GitHub', 'https://github.com/', 4],
    ]);
    const added = bookmarks.require('bm_tab_web-new-1');
    assert.equal(added.origin, 'manual');
    assert.equal(added.version, 1);
    assert.equal(bookmarks.require('b1').version, 2, '位置变了的版本加一');
    assert.deepEqual([bookmarks.require('b5').version, bookmarks.require('b5').position], [1, 4], '删掉的不动');
    assert.equal(bookmarks.all().length, 6, '书签一行不删');

    const { layout, version } = createWebTabsStore(contextOf(db)).read();
    assert.equal(version, 6);
    assert.deepEqual(layout.groups, []);
    assert.deepEqual(layout.today, ['wt-bm-b4']);
    assert.equal(layout.tabs.some((tab) => tab.url.includes('x.com')), false);
    assert.deepEqual(layout.archived.map((entry) => [entry.url, entry.title]),
      [['https://x.com/someone/status/1', '某人的帖子']]);
    const removed = db.all(`SELECT id FROM web_tabs WHERE removed_at IS NOT NULL ORDER BY id`).map((row) => row['id']);
    assert.deepEqual(removed, ['web-new-1', 'web-new-2', 'wt-bm-b1', 'wt-bm-b2']);
    assert.ok(db.all("SELECT removed_at FROM web_tab_groups WHERE id = 'wtg-bookmarks'")[0]?.['removed_at'] !== null);
    const filled = db.all("SELECT version FROM search_sources WHERE source = 'bookmark'")[0]?.['version'];
    assert.ok(filled === undefined || filled === 0, '书签的查找索引下次打开时重填');

    assert.deepEqual(migrate(db, MIGRATIONS.filter((migration) => migration.id <= ID), steppingClock()), []);
  } finally {
    db.close();
  }
});

test('Missing or already-split Bookmarks group is a no-op without bumping version', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), steppingClock());
    bookmark(db, 'b1', { kind: 'page', title: '一篇笔记', target: '#/notes/n1', position: 0 });
    migrate(db, MIGRATIONS.filter((migration) => migration.id <= ID), steppingClock());
    assert.equal(layoutVersion(db), 0);
    assert.equal(createBookmarkStore(contextOf(db)).require('b1').version, 1);
  } finally {
    db.close();
  }
});

test('Bookmarks group already disbanded by user (removed_at set) is untouched', () => {
  const db = beforeApart();
  try {
    db.run("UPDATE web_tab_groups SET removed_at = '2026-11-08T03:00:00.000Z' WHERE id = 'wtg-bookmarks'");
    db.run("UPDATE web_tabs SET place = 'today', group_id = NULL WHERE group_id = 'wtg-bookmarks'");
    const before = layoutVersion(db);
    migrate(db, MIGRATIONS.filter((migration) => migration.id <= ID), steppingClock());
    assert.equal(layoutVersion(db), before);
    assert.equal(db.all('SELECT count(*) AS n FROM web_tabs WHERE removed_at IS NOT NULL')[0]?.['n'], 0);
  } finally {
    db.close();
  }
});
