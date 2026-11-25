import type { Migration } from './migrate.ts';
import { inList, jsonColumn } from './sql.ts';

const STATES = ['pending', 'done', 'skipped', 'failed'] as const;

const TABLE = `CREATE TABLE feed_translations (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES feed_items (id),
  state TEXT NOT NULL CHECK (state IN ${inList(STATES)}),
  lang TEXT,
  title TEXT,
  text TEXT,
  digest TEXT,
  ${jsonColumn('chart', true)},
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0094-feed-translations',
  up(db) {
    db.exec(TABLE);
    db.exec('CREATE INDEX feed_translations_state ON feed_translations (state, updated_at)');
  },
};
