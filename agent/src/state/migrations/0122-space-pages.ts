import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

const GENRE = `genre TEXT CHECK (genre IS NULL OR genre IN ${inList(['report', 'letter'])})`;

const REWRITES = `CREATE TABLE space_rewrites (
  space_id TEXT PRIMARY KEY NOT NULL REFERENCES spaces (id),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  done_at TEXT,
  updated_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0122-space-pages',
  up(db) {
    for (const table of ['spaces', 'space_revisions']) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${GENRE}`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN html TEXT`);
    }
    db.exec(REWRITES);
  },
};
