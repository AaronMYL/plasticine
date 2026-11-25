import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0133-contact-links',
  up(db) {
    db.exec('ALTER TABLE contacts ADD COLUMN alias TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN person_doc_id TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN link_dismissed_at TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN removed_at TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN ai_name TEXT');
    db.exec('ALTER TABLE group_messages ADD COLUMN reply_to TEXT');
  },
};
