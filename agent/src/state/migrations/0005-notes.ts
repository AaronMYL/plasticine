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
