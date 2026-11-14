// 迁移 0136（11-13 Aaron 定）：队友加画风和脸型两列，已有的队友是扁平、萌脸，看起来和以前一样。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../src/state/db.ts';
import { MIGRATIONS } from '../../src/state/migrations/index.ts';
import { openTestState } from './helpers.ts';

const ID = '0136-mate-looks';

test('迁移登记了，不是可以删东西的迁移', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
});

test('已有的队友补上扁平、萌脸，别的字段不动', async () => {
  const fixture = await openTestState();
  try {
    const { state } = fixture;
    const line = state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '研究' });
    const mate = state.mates.create({ name: '资料研究员', avatar: 'cat', hue: 'rose', role: '查资料', soul: '先读原文',
      purpose: null, lineId: line.id });
    fixture.close();

    const db = openDatabase(fixture.path);
    try {
      // 退回迁移前的表：去掉这两列再跑一遍。
      db.exec('ALTER TABLE mates DROP COLUMN variant');
      db.exec('ALTER TABLE mates DROP COLUMN face');
      const migration = MIGRATIONS.find((entry) => entry.id === ID);
      assert.ok(migration !== undefined);
      migration.up(db, { writeNoteBody: () => { throw new Error('不写笔记'); } });
      const row = db.get('SELECT name, avatar, hue, soul, variant, face FROM mates WHERE id = $id', { id: mate.id });
      assert.deepEqual({ ...row }, { name: '资料研究员', avatar: 'cat', hue: 'rose', soul: '先读原文', variant: 'solid',
        face: 'cute' });
    } finally { db.close(); }
  } finally { await fixture.cleanup(); }
});
