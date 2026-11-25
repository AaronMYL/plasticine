import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIN_SOUL_OPENING } from '../../shared/soul-text.ts';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('0139 initializes starter Soul for main and \'You are my ...\' Soul per teammate', () => {
  const db = openDatabase(':memory:');
  const at = '2026-11-14T00:00:00.000Z';
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0139'), () => at);
    db.run(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
      VALUES ('line_job', $at, $at, 'side', '求职顾问', 'idle')`, { at });
    db.run(`INSERT INTO mates (id, created_at, updated_at, version, name, avatar, hue, role, soul, purpose, line_id)
      VALUES ('mate_job', $at, $at, 1, '求职顾问', 'cat', 'teal', '简历、投递和面试准备。', '', NULL, 'line_job')`,
    { at });
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), ['0139-souls', '0140-feed-more-images',
      '0141-drop-agreements', '0142-drop-agreement-history', '0143-drop-retired-history', '0144-mate-relays',
      '0145-wakes-watches', '0146-plans-pushes-connections',
      '0147-retired-tables-action-indexes', '0148-memory-doc-usage',
      '0149-note-private-flag-retired', '0150-model-calls']);
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
