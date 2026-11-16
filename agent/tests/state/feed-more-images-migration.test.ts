// 迁移 0140（11-14 图片统一，Aaron 弹框选「只改 X，其余只放封面」）：信息流条目加「封面以外的图」一列，旧条目是空的，
// 封面一张不动；再跑一遍不重复。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('0140：信息流条目加 more_images，旧条目是空数组，封面不动；重跑不重复', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const at = '2026-11-14T10:00:00.000Z';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0140-feed-more-images'), () => at);
    db.run(`INSERT INTO feed_sources (id, created_at, updated_at, version, ref, kind, label, level)
      VALUES ('src-x', $at, $at, 1, 'x:following', 'x', 'X', 'normal')`, { at });
    db.run(`INSERT INTO feed_items (id, created_at, updated_at, version, source_id, origin, title, summary, why,
      dedupe_key, day, arrived_at, image_url, image_ratio) VALUES ('item-1', $at, $at, 1, 'src-x', 'feed', '一条帖子',
      '', '', 'x:1', '2026-11-14', $at, 'https://pbs.twimg.com/media/a.jpg', 0.6)`, { at });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), ['0140-feed-more-images', '0141-drop-agreements',
      '0142-drop-agreement-history', '0143-drop-retired-history', '0144-mate-relays']);
    const row = db.get('SELECT image_url, image_ratio, more_images FROM feed_items WHERE id = $id', { id: 'item-1' });
    assert.deepEqual({ ...row },
      { image_url: 'https://pbs.twimg.com/media/a.jpg', image_ratio: 0.6, more_images: '[]' });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), []);
  } finally {
    db.close();
  }
});
