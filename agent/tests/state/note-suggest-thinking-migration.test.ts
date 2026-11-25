import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

const ID = '0120-note-suggest-thinking';
const SOL = { provider: 'openai', model: 'gpt-6.1-sol' };

function before(db: Database): void {
  migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), steppingClock());
}

function stored(db: Database): unknown {
  const row = db.get("SELECT value FROM kernel_settings WHERE key = 'model_purposes'");
  return row === undefined ? undefined : JSON.parse(String(row['value']));
}

function save(db: Database, value: unknown): void {
  db.run(`INSERT INTO kernel_settings (key, value, updated_at) VALUES ('model_purposes', $value, $at)`,
    { value: JSON.stringify(value), at: '2026-11-09T00:00:00.000Z' });
}

test('Migration is registered and non-destructive', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('Resets custom think level for continuation/supplement to follow, bumping version', () => {
  const db = openDatabase(MEMORY_DATABASE);
  before(db);
  const enabled = { openai: ['gpt-6.1-sol'] };
  save(db, { version: 7, default: { ...SOL, thinking: 'medium' }, enabled, overrides: {
    note_predict: { model: SOL, thinking: 'low' },
    note_interject: { model: SOL, thinking: 'high' },
    note_polish: { model: null, thinking: 'high' },
  } });
  migrate(db, MIGRATIONS, steppingClock());
  assert.deepEqual(stored(db), { version: 8, default: { ...SOL, thinking: 'medium' }, enabled, overrides: {
    note_predict: { model: SOL, thinking: null },
    note_interject: { model: SOL, thinking: null },
    note_polish: { model: null, thinking: 'high' },
  } });
});

test('No-op when settings absent or continuation/supplement have no custom think level', () => {
  const empty = openDatabase(MEMORY_DATABASE);
  migrate(empty, MIGRATIONS, steppingClock());
  assert.equal(stored(empty), undefined);
  const db = openDatabase(MEMORY_DATABASE);
  before(db);
  const config = { version: 3, default: null, enabled: {}, overrides: {
    note_predict: { model: SOL, thinking: null }, note_interject: { model: null, thinking: 'off' } } };
  save(db, config);
  migrate(db, MIGRATIONS, steppingClock());
  assert.deepEqual(stored(db), config);
});
