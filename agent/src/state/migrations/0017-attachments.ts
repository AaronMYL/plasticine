import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0017-attachments',
  up(db) {
    db.exec(`CREATE TABLE attachments (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL,
      metadata TEXT NOT NULL CHECK (json_valid(metadata)), text_content TEXT)`);
    db.exec(`CREATE TABLE message_attachments (
      message_id TEXT NOT NULL REFERENCES messages(id), attachment_id TEXT NOT NULL REFERENCES attachments(id),
      position INTEGER NOT NULL, PRIMARY KEY (message_id, attachment_id), UNIQUE (message_id, position))`);
  },
};
