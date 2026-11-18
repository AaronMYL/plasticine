// 0149：笔记上的「私密」记号退役，标着的都变回普通笔记；别的列一个不动。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

const ID = '0149-note-private-flag-retired';
const UP_TO = MIGRATIONS.filter((entry) => entry.id <= ID);
const META = "'2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 3";

test('0149 把标着私密的笔记都变成普通笔记，标题、版本和改动时间不动', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const clock = (): string => '2026-11-18T00:00:00.000Z';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < ID), clock);
    const note = (id: string, title: string, flag: number): void => {
      db.run(`INSERT INTO notes (id, created_at, updated_at, version, title, folder, private, author, preview,
        body_file, body_bytes, body_sha256)
        VALUES ($id, ${META}, $title, '笔记', $flag, 'user', '', $file, 0, '')`, { id, title, flag, file: `${id}.md` });
    };
    note('n1', '周末去哪', 1);
    note('n2', '读书摘抄', 0);
    note('n3', '装修清单', 1);
    migrate(db, UP_TO, clock);
    const rows = db.all('SELECT id, title, private, version, updated_at FROM notes ORDER BY id');
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { id: 'n1', title: '周末去哪', private: 0, version: 3, updated_at: '2026-11-02T00:00:00.000Z' },
      { id: 'n2', title: '读书摘抄', private: 0, version: 3, updated_at: '2026-11-02T00:00:00.000Z' },
      { id: 'n3', title: '装修清单', private: 0, version: 3, updated_at: '2026-11-02T00:00:00.000Z' },
    ]);
  } finally {
    db.close();
  }
});
