import type { Migration } from './migrate.ts';

export const migration: Migration = { id: '0127-network-attachments', up(db) {
  db.exec(`CREATE TABLE network_attachments (
    id TEXT PRIMARY KEY NOT NULL, request_id TEXT UNIQUE,
    remote_id TEXT NOT NULL, source_account_id TEXT NOT NULL, local_owner INTEGER NOT NULL,
    thread_id TEXT, contact_message_id TEXT REFERENCES contact_messages(id),
    group_message_id TEXT REFERENCES group_messages(id),
    recipients TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recipients)),
    metadata TEXT NOT NULL CHECK(json_valid(metadata)), content BLOB,
    text_content TEXT, error TEXT, created_at TEXT NOT NULL,
    CHECK(content IS NULL OR length(content) <= 26214400),
    CHECK(contact_message_id IS NULL OR group_message_id IS NULL))`);
  db.exec('CREATE INDEX network_attachments_contact ON network_attachments(contact_message_id)');
  db.exec('CREATE INDEX network_attachments_group ON network_attachments(group_message_id)');
  db.exec(`CREATE UNIQUE INDEX network_attachments_received ON network_attachments
    (source_account_id, remote_id, thread_id, COALESCE(contact_message_id, group_message_id))`);
} };
