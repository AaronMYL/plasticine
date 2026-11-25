import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0049-own-notice-twins',
  up(db) {
    db.exec(`UPDATE inbox_messages SET
      archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      version = version + 1
      WHERE source = 'plasticine' AND message_id IS NOT NULL AND archived_at IS NULL
        AND EXISTS (SELECT 1 FROM inbox_messages AS original
          WHERE original.source = 'plasticine' AND original.message_id IS NULL
            AND original.id <> inbox_messages.id AND original.title = inbox_messages.title
            AND abs(julianday(original.received_at) - julianday(inbox_messages.received_at)) * 86400 < 600)`);
  },
};
