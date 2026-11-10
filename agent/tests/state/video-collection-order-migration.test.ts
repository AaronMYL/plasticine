import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

const ID = '0123-video-collection-order';
test('收藏顺序迁移只加列，原作品、日期、阶段和转写结果保留', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), steppingClock());
    db.run(`INSERT INTO video_works (id, created_at, updated_at, version, platform, work_id, url, title,
      collected_at, folder_ids, stage, want, run, transcript)
      VALUES ('video-1', $at, $at, 3, 'douyin', '7300000000000000001', 'https://example.com/video', '示例作品',
        $at, '[]', 'summarized', 'full', 'idle', '原始逐字稿')`, { at: '2026-11-01T00:00:00.000Z' });
    const before = db.get("SELECT * FROM video_works WHERE id = 'video-1'");
    migrate(db, MIGRATIONS, steppingClock());
    assert.deepEqual({ ...db.get("SELECT * FROM video_works WHERE id = 'video-1'") },
      { ...before, collect_seq: null, space_id: null });
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
    assert.equal(db.get('PRAGMA integrity_check')?.['integrity_check'], 'ok');
  } finally { db.close(); }
});
