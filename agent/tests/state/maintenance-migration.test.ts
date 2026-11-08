// 迁移 0050（第 115 条）：建维护入口的操作记录表；规则 feed_interest（信息流命中关注点开试做）改成关，记一条
// 迁移事件带用户 11-04 的决定；已经关了的、还没种的不动；新库按 seed 种成关。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureIntake } from '../../src/intake/index.ts';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { createIntakeStores } from '../../src/state/intake.ts';
import { migrate, MIGRATIONS as EVERY_MIGRATION } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { openState } from '../../src/state/index.ts';
import { steppingClock } from './helpers.ts';

// 讲的是 0058 之前的历史：只跑到 0058（0059 起的清理在 retire-migration.test.ts）。
const MIGRATIONS = EVERY_MIGRATION.filter((entry) => entry.id < '0059');

test('0049 的库里 feed_interest 是自动：0050 改成关、版本加一、记一条迁移事件；别的规则不动；重跑不再改', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0050'), now);
    let n = 0;
    const context: StoreContext = { db, now, newId: () => `id-${(n += 1)}` };
    const { rules } = createIntakeStores(context);
    const base = { sourceKinds: ['feed' as const], triggerKinds: ['feed.interest_hit'], trialable: true,
      basisKind: 'plasticine' as const, strength: 'inferred' as const };
    const interest = rules.create({ ...base, code: 'feed_interest', name: '信息流命中关注点', text: '提议收进待看',
      mode: 'auto' });
    const fix = rules.create({ ...base, code: 'self_fix', name: '修自己的失败', text: '开自迭代', mode: 'auto' });

    const upTo0050 = MIGRATIONS.filter((entry) => entry.id < '0051');
    assert.deepEqual(migrate(db, upTo0050, now), ['0050-maintenance']);
    const off = rules.require(interest.id);
    assert.equal(off.mode, 'off');
    assert.equal(off.version, interest.version + 1);
    const event = rules.events(off.id).at(-1);
    assert.equal(event?.kind, 'mode_changed');
    assert.equal(event?.fromMode, 'auto');
    assert.equal(event?.toMode, 'off');
    assert.equal(event?.actor, 'migration');
    assert.match(event?.reason ?? '', /2026-11-04/);
    assert.equal(rules.require(fix.id).version, fix.version);
    assert.equal(rules.require(fix.id).mode, 'auto');
    assert.deepEqual(migrate(db, upTo0050, now), []);
    assert.equal(rules.events(off.id).length, 1);
  } finally {
    db.close();
  }
});

test('新库：迁移建好 maintenance_operations；还没有规则时 0050 什么都不改，seed 把 feed_interest 种成关', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const applied = migrate(db, MIGRATIONS, steppingClock());
    assert.ok(applied.includes('0050-maintenance'));
    const table = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'maintenance_operations'");
    assert.equal(table?.['name'], 'maintenance_operations');
  } finally {
    db.close();
  }
  const state = openState({ path: ':memory:', now: steppingClock() });
  try {
    ensureIntake(state);
    assert.equal(state.rules.byCode('feed_interest')?.mode, 'off');
    // self_fix 2026-11-05 随自迭代删掉，不再种。
    assert.equal(state.rules.byCode('self_fix'), undefined);
  } finally {
    state.close();
  }
});
