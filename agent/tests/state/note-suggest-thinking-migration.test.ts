// 迁移 0120（2026-11-09 他定：笔记续写、主动补充不开思考）：这两个用途单独选过的思考档改回跟随，让新的默认「关」生效；
// 选的模型、别的用途、全局默认都不动。

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

test('迁移登记了，不是可以删东西的迁移', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('续写、主动补充单独选的思考档改回跟随（默认关），模型和别的用途不动，版本加一', () => {
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

test('没存过设置、两个用途没单独选思考档：什么也不改', () => {
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
