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
