import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('Backfills legacy handoffs into teammate chat and sets direction on origin result', () => {
  const db = openDatabase(':memory:');
  const at = '2026-11-16T06:00:00.000Z';
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0144'), () => at);
    const line = (id: string, extra: string, values: string) => db.run(`INSERT INTO lines (id, created_at,
      updated_at, kind, title, status${extra}) VALUES ('${id}', '${at}', '${at}', ${values})`);
    line('line-main', '', "'main', '主对话', 'idle'");
    line('line-mate', '', "'side', '求职顾问', 'idle'");
    db.run(`INSERT INTO mates (id, created_at, updated_at, version, name, avatar, hue, role, soul, line_id)
      VALUES ('mate-1', '${at}', '${at}', 1, '求职顾问', 'bob', 'teal', '投递', '', 'line-mate')`);
    line('line-work', ', parent_line_id, mate_id, resume_parent',
      "'background', '求职顾问 · 打招呼', 'idle', 'line-main', 'mate-1', 1");
    line('line-asked', ', parent_line_id, mate_id, resume_parent',
      "'background', '求职顾问 · 用户点名', 'idle', 'line-main', 'mate-1', 0");
    const put = (lineId: string, seq: number, role: string, message: unknown, when: string) => db.run(
      `INSERT INTO line_messages (line_id, seq, role, message, created_at) VALUES ($line, $seq, $role, $message, $at)`,
      { line: lineId, seq, role, message: JSON.stringify(message), at: when });
    put('line-work', 1, 'user', { role: 'user', content: '给成都岗位打招呼', timestamp: 1 }, '2026-11-16T06:10:00Z');
    put('line-main', 1, 'lineReport', { role: 'lineReport', lineId: 'line-work', title: '打招呼', outcome: 'done',
      text: '打了 3 个', timestamp: 2 }, '2026-11-16T06:20:00Z');
    put('line-main', 2, 'lineReport', { role: 'lineReport', lineId: 'line-asked', title: '点名', outcome: 'done',
      text: '点名的结果', timestamp: 3 }, '2026-11-16T06:30:00Z');
    put('line-mate', 1, 'user', { role: 'user', content: '你好', timestamp: 0 }, '2026-11-15T06:00:00Z');
    migrate(db, MIGRATIONS, () => at);
    const own = db.all("SELECT seq, role, message FROM line_messages WHERE line_id = 'line-mate' ORDER BY seq");
    assert.deepEqual(own.map((row) => row['role']), ['user', 'handoff', 'lineReport']);
    const handoff = JSON.parse(String(own[1]!['message'])) as Record<string, unknown>;
    assert.equal(handoff['text'], '给成都岗位打招呼');
    assert.deepEqual(handoff['relay'], { from: { kind: 'main' }, to: { kind: 'mate', id: 'mate-1' } });
    assert.equal((JSON.parse(String(own[2]!['message'])) as Record<string, unknown>)['own'], true);
    const main = db.all("SELECT message FROM line_messages WHERE line_id = 'line-main' ORDER BY seq")
      .map((row) => JSON.parse(String(row['message'])) as Record<string, unknown>);
    assert.deepEqual(main[0]!['relay'], { from: { kind: 'mate', id: 'mate-1' }, to: { kind: 'main' } });
    assert.equal(main[1]!['relay'], undefined);
  } finally {
    db.close();
  }
});
