import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmarkStore } from '../../src/state/bookmarks.ts';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { createFeedItemStore } from '../../src/state/feed-items.ts';
import { createFeedSourceStore } from '../../src/state/feed-sources.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import { createProjectStore } from '../../src/state/projects.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { steppingClock } from './helpers.ts';

const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059' || entry.id === '0138-feed-places-body'
  || entry.id === '0140-feed-more-images');

test('0044 migrates starred feed items to bookmarks with project, idempotently', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    const feedColumns = (entry: { id: string }): boolean => entry.id === '0054-feed-sources-x'
      || entry.id === '0138-feed-places-body' || entry.id === '0140-feed-more-images';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0045' || feedColumns(entry)), now);
    let n = 0;
    const context: StoreContext = { db, now, newId: () => `id-${(n += 1)}` };
    const projects = createProjectStore(context);
    const sources = createFeedSourceStore(context);
    const items = createFeedItemStore(context);
    const project = projects.create({ name: 'Cyber Hunter' });
    const concern = { id: 'concern-1' };
    db.run(`INSERT INTO concerns (id, created_at, updated_at, version, title, kind, why, initiator, lifecycle,
      activities, wait_conditions, trigger_conditions, channel, agreement_ids)
      VALUES ('concern-1', $at, $at, 1, '冷启动渠道', 'goal', '测试', 'user', 'active', '[]', '[]', '[]',
      'next_report', '[]')`, { at: now() });
    db.run(`INSERT INTO project_items (id, project_id, target_type, target_id, added_by, reason, created_at)
      VALUES ('item-1', $project, 'concern', 'concern-1', 'user', '测试', $at)`, { project: project.id, at: now() });
    const source = sources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加', level: 'normal' });
    const base = { sourceId: source.id, origin: 'manual' as const, day: '2026-10-27',
      arrivedAt: '2026-10-27T08:00:00.000Z' };
    const web = items.add({ ...base, title: 'Show HN 规则', url: 'https://news.ycombinator.com/showhn.html',
      summary: '先读规则再发帖。', concernId: concern.id, dedupeKey: 'a' }).item;
    const page = items.add({ ...base, title: '做完了：周报', summary: '', dedupeKey: 'b' }).item;
    const plain = items.add({ ...base, title: '没收藏的', url: 'https://example.com/', dedupeKey: 'c' }).item;
    items.update(web.id, web.version, { savedAt: '2026-10-28T01:00:00.000Z' });
    items.update(page.id, page.version, { savedAt: '2026-10-28T02:00:00.000Z' });
    const before = db.all('SELECT * FROM feed_items ORDER BY id').map((row) => ({ ...row }));

    const upTo0045 = MIGRATIONS.filter((entry) => entry.id < '0046' || feedColumns(entry));
    assert.deepEqual(migrate(db, upTo0045, now), ['0045-bookmarks']);
    const bookmarks = createBookmarkStore(context);
    const rows = bookmarks.live().map((row) => [row.id, row.kind, row.title, row.target, row.projectId, row.origin,
      row.feedItemId, row.snapshot, row.position]);
    assert.deepEqual(rows, [
      [`bm_feed_${web.id}`, 'web', 'Show HN 规则', 'https://news.ycombinator.com/showhn.html', project.id, 'feed',
        web.id, '先读规则再发帖。', 0],
      [`bm_feed_${page.id}`, 'page', '做完了：周报', `#/feed/${page.id}`, null, 'feed', page.id, null, 1],
    ]);
    assert.equal(bookmarks.all().some((row) => row.feedItemId === plain.id), false);
    assert.deepEqual(db.all('SELECT * FROM feed_items ORDER BY id').map((row) => ({ ...row })), before);
    assert.deepEqual(migrate(db, upTo0045, now), []);
    assert.equal(bookmarks.all().length, 2);
  } finally {
    db.close();
  }
});
