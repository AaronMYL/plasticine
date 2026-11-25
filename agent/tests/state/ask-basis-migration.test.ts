import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

test('0057 adds basis column defaulting NULL, enforces 4 values, idempotent on rerun', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0057'), now);
    db.run(`INSERT INTO asks (id, created_at, updated_at, version, kind, purpose, channel, question, options, status)
      VALUES ('old', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 1, 'decide', 'cognition', 'popup',
        '旧卡', '[]', 'open')`);
    assert.deepEqual(migrate(db, MIGRATIONS, now), ['0057-ask-basis', '0058-lines']);
    assert.equal(db.get("SELECT basis FROM asks WHERE id = 'old'")?.['basis'], null);
    db.run("UPDATE asks SET basis = 'hard_line' WHERE id = 'old'");
    assert.equal(db.get("SELECT basis FROM asks WHERE id = 'old'")?.['basis'], 'hard_line');
    assert.throws(() => db.run("UPDATE asks SET basis = 'confident' WHERE id = 'old'"));
    assert.deepEqual(migrate(db, MIGRATIONS, now), []);
  } finally {
    db.close();
  }
});
