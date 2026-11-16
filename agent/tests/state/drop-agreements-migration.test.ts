// 迁移 0141（11-15 记忆分层第三版，Aaron 同意删）：旧约定、旧词表、旧设备钥匙三张表删掉，查找索引里约定那一类清掉；
// 记忆行、旧记忆条目、改动历史不动；再跑一遍不重复。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

const ID = '0141-drop-agreements';

test('0141：三张旧表删掉，索引里约定那一类清掉，别的索引和改动历史不动；重跑不重复', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const at = '2026-11-15T10:00:00.000Z';
    migrate(db, MIGRATIONS.filter((entry) => entry.id < ID), () => at);
    const doc = (source: string, ref: string, title: string): void => {
      db.run(`INSERT INTO search_docs (source, ref, kind, object_kind, object_id, title, body, detail, updated_at)
        VALUES ($source, $ref, 'x', 'x', $ref, $title, '', '', $at)`, { source, ref, title, at });
      const row = db.get('SELECT id FROM search_docs WHERE source = $source AND ref = $ref', { source, ref });
      db.run("INSERT INTO search_fts (rowid, title, body, detail) VALUES ($id, $title, '', '')",
        { id: row?.['id'] ?? null, title });
    };
    doc('agreement', 'agreement-1', '定时任务可以自己加');
    doc('note', 'note-1', '定时任务的笔记');
    db.run("INSERT INTO search_sources (source, version, filled_at) VALUES ('agreement', 1, $at)", { at });
    db.run(`INSERT INTO versions (id, object_type, object_id, version, actor, reason, fields, snapshot, created_at,
      migrated_default) VALUES ('version-1', 'agreement', 'agreement-1', 1, 'user', '旧约定', '[]', '{}', $at, 0)`,
    { at });
    const tables = (): string[] => db.all(`SELECT name FROM sqlite_schema WHERE type = 'table'
      AND name IN ('agreements', 'term_decodings', 'device_keys') ORDER BY name`).map((row) => String(row['name']));
    assert.deepEqual(tables(), ['agreements', 'device_keys', 'term_decodings']);

    assert.deepEqual(migrate(db, MIGRATIONS, () => at), [ID]);
    assert.deepEqual(tables(), []);
    assert.deepEqual(db.all('SELECT source FROM search_docs').map((row) => row['source']), ['note']);
    assert.deepEqual(db.all("SELECT rowid FROM search_fts WHERE search_fts MATCH '定时任务'").length, 1);
    assert.equal(db.all("SELECT 1 FROM search_sources WHERE source = 'agreement'").length, 0);
    assert.equal(db.all("SELECT 1 FROM versions WHERE object_type = 'agreement'").length, 1);
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), []);
  } finally {
    db.close();
  }
});
