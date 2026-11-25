import type { Database } from '../../src/state/db.ts';

export interface OldInboxRow {
  id: string;
  source: string;
  fromAddress: string;
  fromName?: string | null;
  title: string;
  body?: string;
  receivedAt: string;
  toAddress?: string | null;
  messageId?: string | null;
  legacy?: unknown;
}

export function insertOldInbox(db: Database, row: OldInboxRow): void {
  db.run(`INSERT INTO inbox_messages (id, created_at, updated_at, version, migrated_default, legacy_payload, source,
      from_address, from_name, title, body, received_at, act, attachments, message_id, to_address)
    VALUES ($id, $at, $at, 1, $migrated, $legacy, $source, $from_address, $from_name, $title, $body, $at, 0, '[]',
      $message_id, $to_address)`, {
    id: row.id,
    at: row.receivedAt,
    migrated: row.legacy === undefined ? 0 : 1,
    legacy: row.legacy === undefined ? null : JSON.stringify(row.legacy),
    source: row.source,
    from_address: row.fromAddress,
    from_name: row.fromName ?? null,
    title: row.title,
    body: row.body ?? '正文',
    message_id: row.messageId ?? null,
    to_address: row.toAddress ?? null,
  });
}

export function readInbox(db: Database, id: string): Record<string, unknown> {
  const row = db.get('SELECT * FROM inbox_messages WHERE id = $id', { id });
  if (row === undefined) {
    throw new Error(`没有 ${id} 这一行`);
  }
  return { ...row };
}
