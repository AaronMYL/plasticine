// 迁移 0057（《置信度与做事方式改动方案》第 5 批）：卡上多记一项「依据」（推出来的 / 有几种可能 / 资料里没有 / 硬线）。
// 只加列：上线前的旧卡都是 NULL，不倒推、不补；度量里记成「没标依据」。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';

// 讲的是 0058 之前的历史：只跑到 0058（0059 起的清理在 retire-migration.test.ts）。
const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

test('0057：卡多一列依据，旧卡是 NULL；只认四种依据；重跑不变', () => {
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
