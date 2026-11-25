import type { Migration } from './migrate.ts';
import { inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SPACES = `CREATE TABLE spaces (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  ${jsonColumn('doc', false)},
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  subscription_id TEXT REFERENCES space_subscriptions (id),
  issue_number INTEGER CHECK (issue_number IS NULL OR issue_number >= 1),
  edition TEXT CHECK (edition IS NULL OR edition IN ${inList(['daily', 'weekly'])}),
  source_note_id TEXT,
  deleted_at TEXT
)`;

const REVISIONS = `CREATE TABLE space_revisions (
  space_id TEXT NOT NULL REFERENCES spaces (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  ${jsonColumn('doc', false)},
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  saved_at TEXT NOT NULL,
  change TEXT,
  rule TEXT,
  restored_from INTEGER,
  PRIMARY KEY (space_id, version)
)`;

const SUBSCRIPTIONS = `CREATE TABLE space_subscriptions (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['research', 'review'])}),
  status TEXT NOT NULL CHECK (status IN ${inList(['draft', 'sample', 'active', 'paused'])}),
  ${jsonColumn('settings', false)},
  time_zone TEXT NOT NULL,
  line_id TEXT,
  last_run_at TEXT
)`;

export const migration: Migration = {
  id: '0083-spaces',
  up(db) {
    db.exec(SUBSCRIPTIONS);
    db.exec(SPACES);
    db.exec(REVISIONS);
    db.exec('CREATE INDEX spaces_updated ON spaces (deleted_at, updated_at)');
    db.exec('CREATE INDEX spaces_subscription ON spaces (subscription_id, issue_number)');
    db.exec('CREATE UNIQUE INDEX spaces_source_note ON spaces (source_note_id) WHERE source_note_id IS NOT NULL');
    db.exec('ALTER TABLE notes ADD COLUMN moved_to_space_id TEXT');
    db.exec('ALTER TABLE note_folders ADD COLUMN retired_at TEXT');
  },
};
