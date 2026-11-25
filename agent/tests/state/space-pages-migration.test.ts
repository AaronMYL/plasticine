import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

const ID = '0122-space-pages';
const AT = '2026-11-09T00:00:00.000Z';
const DOC = JSON.stringify({ headline: '学会识别会改变神经表征', stats: [], blocks: [], sources: [] });

function before(db: Database): void {
  migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), steppingClock());
}

test('Migration is registered and non-destructive', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('Legacy spaces keep doc with null genre/html; new version stores genre and HTML', () => {
  const db = openDatabase(MEMORY_DATABASE);
  before(db);
  db.run(`INSERT INTO spaces (id, created_at, updated_at, version, title, doc, author)
    VALUES ('s-1', $at, $at, 1, '周报', $doc, 'ai')`, { at: AT, doc: DOC });
  db.run(`INSERT INTO space_revisions (space_id, version, title, doc, author, saved_at)
    VALUES ('s-1', 1, '周报', $doc, 'ai', $at)`, { at: AT, doc: DOC });
  migrate(db, MIGRATIONS, steppingClock());
  const row = db.get("SELECT doc, genre, html FROM spaces WHERE id = 's-1'");
  assert.deepEqual([row?.['doc'], row?.['genre'], row?.['html']], [DOC, null, null]);
  const revision = db.get("SELECT genre, html FROM space_revisions WHERE space_id = 's-1'");
  assert.deepEqual([revision?.['genre'], revision?.['html']], [null, null]);
  db.run("UPDATE spaces SET genre = 'letter', html = '<p>信</p>' WHERE id = 's-1'");
  assert.throws(() => db.run("UPDATE spaces SET genre = 'poster' WHERE id = 's-1'"));
  db.run(`INSERT INTO space_rewrites (space_id, attempts, done_at, updated_at) VALUES ('s-1', 1, $at, $at)`,
    { at: AT });
  assert.equal(db.get("SELECT attempts FROM space_rewrites WHERE space_id = 's-1'")?.['attempts'], 1);
});
