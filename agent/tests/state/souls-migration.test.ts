// 迁移 0139（第13批，11-14 Aaron 同意加的表）：主线和每位队友各一份 Soul 和改动记录。起步：主线是 Aaron 给的那段
// （第二人称），队友把原来的职责写成开头「你是我的……」；各记一条「起步」。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIN_SOUL_OPENING } from '../../shared/soul-text.ts';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('0139：主线一份起步的 Soul，每位队友一份「你是我的……」加原来的职责，各记一条起步', () => {
  const db = openDatabase(':memory:');
  const at = '2026-11-14T00:00:00.000Z';
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0139'), () => at);
    db.run(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
      VALUES ('line_job', $at, $at, 'side', '求职顾问', 'idle')`, { at });
    db.run(`INSERT INTO mates (id, created_at, updated_at, version, name, avatar, hue, role, soul, purpose, line_id)
      VALUES ('mate_job', $at, $at, 1, '求职顾问', 'cat', 'teal', '简历、投递和面试准备。', '', NULL, 'line_job')`,
    { at });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), ['0139-souls']);
    const souls = db.all('SELECT owner, text, version FROM souls ORDER BY owner').map((row) => ({ ...row }));
    assert.deepEqual(souls, [{ owner: 'main', text: MAIN_SOUL_OPENING, version: 1 },
      { owner: 'mate_job', text: '你是我的求职顾问：简历、投递和面试准备。', version: 1 }]);
    const revisions = db.all('SELECT owner, actor, before, note FROM soul_revisions ORDER BY owner')
      .map((row) => ({ ...row }));
    assert.deepEqual(revisions, [{ owner: 'main', actor: 'system', before: '', note: '起步' },
      { owner: 'mate_job', actor: 'system', before: '', note: '起步' }]);
  } finally {
    db.close();
  }
});
