import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('0140 adds more_images defaulting empty array, keeps cover, idempotent on rerun', () => {
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
      '0142-drop-agreement-history', '0143-drop-retired-history', '0144-mate-relays',
      '0145-wakes-watches', '0146-plans-pushes-connections',
      '0147-retired-tables-action-indexes', '0148-memory-doc-usage',
      '0149-note-private-flag-retired', '0150-model-calls']);
    const row = db.get('SELECT image_url, image_ratio, more_images FROM feed_items WHERE id = $id', { id: 'item-1' });
    assert.deepEqual({ ...row },
      { image_url: 'https://pbs.twimg.com/media/a.jpg', image_ratio: 0.6, more_images: '[]' });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), []);
  } finally {
    db.close();
  }
});
