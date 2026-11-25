import type { Migration } from './migrate.ts';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const TWIN_WINDOW_SECONDS = 600;

const TWIN = `kept.source = 'email' AND kept.legacy_payload IS NULL AND kept.duplicate_of IS NULL
  AND kept.id <> inbox_messages.id
  AND lower(trim(kept.from_address)) = lower(trim(inbox_messages.from_address))
  AND kept.title = inbox_messages.title
  AND abs(julianday(kept.received_at) - julianday(inbox_messages.received_at)) * 86400 < ${TWIN_WINDOW_SECONDS}`;

const COLUMNS = [
  'body_html TEXT',
  'raw_path TEXT',
  'raw_sha256 TEXT',
  'imap_uid INTEGER',
  'uid_validity INTEGER',
  'mailbox TEXT',
  'mime_at TEXT',
  'mime_tried_at TEXT',
  'duplicate_of TEXT REFERENCES inbox_messages (id)',
];

export const migration: Migration = {
  id: '0052-mail-bodies',
  up(db) {
    for (const column of COLUMNS) {
      db.exec(`ALTER TABLE inbox_messages ADD COLUMN ${column}`);
    }
    db.exec(`CREATE TABLE inbox_mail_parts (
      id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL REFERENCES inbox_messages (id),
      content_id TEXT NOT NULL,
      filename TEXT,
      type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size >= 0),
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (message_id, content_id)
    )`);
    db.exec(`UPDATE inbox_messages SET
      duplicate_of = (SELECT kept.id FROM inbox_messages AS kept WHERE ${TWIN}
        ORDER BY abs(julianday(kept.received_at) - julianday(inbox_messages.received_at)), kept.id LIMIT 1),
      updated_at = ${NOW},
      version = version + 1
      WHERE source = 'email' AND legacy_payload IS NOT NULL AND duplicate_of IS NULL
        AND EXISTS (SELECT 1 FROM inbox_messages AS kept WHERE ${TWIN})`);
  },
};
