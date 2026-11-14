// 迁移 0138（第13批）：信息流条目加「在哪一处看到的」和全文两列，旧条目是空的；两个内置来源改名（「X」「兴趣」），
// 他改过名的不动。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('0138：旧条目的位置是空的、没有全文；内置的 X 和「按关注点搜新闻」改名，改过名的不动', () => {
  const db = openDatabase(':memory:');
  const at = '2026-11-14T00:00:00.000Z';
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0138'), () => at);
    const source = (id: string, ref: string, kind: string, label: string): void => {
      db.run(`INSERT INTO feed_sources (id, created_at, updated_at, version, kind, label, level, ref)
        VALUES ($id, $at, $at, 1, $kind, $label, 'normal', $ref)`, { id, at, kind, label, ref });
    };
    source('src_x', 'x:following', 'x', 'X · 你关注的人');
    source('src_news', 'internal:news', 'internal', '按关注点搜新闻');
    source('src_rss', 'rss:a', 'rss', '按关注点搜新闻');
    db.run(`INSERT INTO feed_items (id, created_at, updated_at, version, source_id, origin, title, summary, why,
      dedupe_key, day, arrived_at) VALUES ('item_1', $at, $at, 1, 'src_x', 'feed', '旧帖子', '', '', 'x:1',
      '2026-11-13', $at)`, { at });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), ['0138-feed-places-body']);
    const item = db.all('SELECT places, body FROM feed_items WHERE id = $id', { id: 'item_1' })[0];
    assert.deepEqual({ ...item }, { places: '[]', body: null });
    const labels = db.all('SELECT id, label, version FROM feed_sources ORDER BY id').map((row) => ({ ...row }));
    assert.deepEqual(labels, [{ id: 'src_news', label: '兴趣', version: 2 }, { id: 'src_rss', label: '按关注点搜新闻',
      version: 1 }, { id: 'src_x', label: 'X', version: 2 }]);
  } finally {
    db.close();
  }
});
