import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../agent/src/state/db.ts';
import { migrate, MIGRATIONS } from '../agent/src/state/migrations/index.ts';
import { rehearseMigrations } from './rehearse-migrations.ts';

test('从上批库做一致性副本，七项新迁移保留行和外键，源库版本不变且目标不得覆盖', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'migration-rehearsal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const old = MIGRATIONS.filter((migration) => migration.id < '0123');
  const db = openDatabase(source);
  migrate(db, old, () => '2026-11-01T00:00:00.000Z');
  db.exec('CREATE TABLE rehearsal_fixture(id TEXT PRIMARY KEY, body TEXT)');
  db.run('INSERT INTO rehearsal_fixture VALUES ($id, $body)', { id: 'fixture-one', body: '需要保留的原文' });
  const destination = join(directory, 'copy');
  const report = await rehearseMigrations(source, destination);
  assert.equal(report.passed, true);
  assert.equal(report.after.rehearsal_fixture, 1);
  assert.ok(report.applied.includes('0128-mates'));
  assert.equal(db.get('SELECT count(*) AS n FROM schema_migrations')?.['n'], old.length);
  assert.equal(db.get("SELECT name FROM pragma_table_info('lines') WHERE name = 'mate_id'"), undefined);
  assert.equal(db.get('SELECT body FROM rehearsal_fixture')?.['body'], '需要保留的原文');
  await assert.rejects(rehearseMigrations(source, destination), /EEXIST/);
  db.close();
});

test('迁移自己声明会变的表（0141 的旧约定、设备钥匙、查找索引）变了不算意外，单独列在报告里', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'migration-rehearsal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source.sqlite');
  const db = openDatabase(source);
  const at = '2026-11-15T00:00:00.000Z';
  migrate(db, MIGRATIONS.filter((migration) => migration.id < '0141'), () => at);
  db.run(`INSERT INTO devices (id, created_at, updated_at, version, name, first_seen_at, last_seen_at)
    VALUES ('device-1', $at, $at, 1, '电脑', $at, $at)`, { at });
  db.run(`INSERT INTO device_keys (id, created_at, updated_at, version, device_id, public_key, thumbprint)
    VALUES ('key-1', $at, $at, 1, 'device-1', '{}', $thumb)`, { at, thumb: 'a'.repeat(64) });
  // 查找索引里有约定、也有笔记：删约定那一类时 FTS 的内部表行数会变（可能变多）。
  for (const [source, ref, title] of [['agreement', 'a1', '定时任务可以自己加'], ['note', 'n1', '定时任务的笔记']]) {
    db.run(`INSERT INTO search_docs (source, ref, kind, object_kind, object_id, title, body, detail, updated_at)
      VALUES ($source, $ref, 'x', 'x', $ref, $title, '', '', $at)`, { source: source!, ref: ref!, title: title!, at });
    db.run(`INSERT INTO search_fts (rowid, title, body, detail)
      SELECT id, title, body, detail FROM search_docs WHERE ref = $ref`, { ref: ref! });
  }
  db.close();
  const report = await rehearseMigrations(source, join(directory, 'copy'));
  assert.equal(report.passed, true);
  assert.deepEqual(report.applied,
    ['0141-drop-agreements', '0142-drop-agreement-history', '0143-drop-retired-history', '0144-mate-relays',
      '0145-wakes-watches', '0146-plans-pushes-connections',
      '0147-retired-tables-action-indexes', '0148-memory-doc-usage',
      '0149-note-private-flag-retired', '0150-model-calls']);
  assert.deepEqual(report.rowChanges, []);
  assert.deepEqual(report.declaredChanges.find((row) => row.table === 'device_keys'),
    { table: 'device_keys', before: 1, after: null });
  assert.deepEqual(report.declaredChanges.find((row) => row.table === 'search_docs'),
    { table: 'search_docs', before: 2, after: 1 });
  assert.equal(report.after.devices, 1);
});
