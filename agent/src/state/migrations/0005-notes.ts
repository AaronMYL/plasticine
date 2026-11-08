// M1: note metadata (《实施方案》第 4 节迁移规则 5, decision 90 ①). The text stays a file under the state
// directory's notes/; the row keeps its byte count and SHA-256 so every copy can be checked against it.
// Deleting a note sets deleted_at; neither the row nor the file goes away.

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, OBJECT_COLUMNS } from './sql.ts';

const NOTES = `CREATE TABLE notes (${OBJECT_COLUMNS},
  title TEXT NOT NULL,
  folder TEXT NOT NULL,
  ${booleanColumn('pinned', 0)},
  ${booleanColumn('private', 0)},
  ${booleanColumn('read_only', 0)},
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  preview TEXT NOT NULL,
  body_file TEXT NOT NULL UNIQUE,
  body_bytes INTEGER NOT NULL CHECK (body_bytes >= 0),
  body_sha256 TEXT NOT NULL,
  deleted_at TEXT
)`;

const INDEXES = ['CREATE INDEX notes_list ON notes (deleted_at, pinned, updated_at)'];

export const migration: Migration = {
  id: '0005-notes',
  up(db) {
    for (const statement of [NOTES, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
