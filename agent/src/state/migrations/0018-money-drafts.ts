import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0018-money-drafts',
  up(db) {
    db.exec(`CREATE TABLE money_drafts (id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE, attachment_id TEXT NOT NULL UNIQUE REFERENCES attachments(id),
      sha256 TEXT NOT NULL, entry_id TEXT UNIQUE REFERENCES money_entries(id),
      metadata TEXT NOT NULL CHECK (json_valid(metadata)))`);
    db.exec('CREATE INDEX money_draft_digest ON money_drafts(sha256)');
  },
};
