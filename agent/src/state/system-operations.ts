import type { StoreContext } from './object-store.ts';

const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
export function createSystemOperationsStore(context: StoreContext) {
  const { db } = context;
  return {
    read() {
      const sent = db.get("SELECT max(sent_at) AS at FROM inbox_replies WHERE status = 'sent'");
      const reply = db.get('SELECT updated_at, error FROM inbox_replies ORDER BY updated_at DESC LIMIT 1');
      const lastError = nullable(reply?.['error']);
      const sentAt = nullable(sent?.['at']);
      const received = db.get('SELECT received_at FROM inbox_messages WHERE source = $source '
        + 'ORDER BY received_at DESC LIMIT 1', { source: 'email' });
      const sync = db.get('SELECT last_error FROM inbox_sync WHERE id = $id', { id: 'imap' });
      const asks = db.all('SELECT id, created_at, kind, question FROM asks ORDER BY created_at DESC LIMIT 50');
      return {
        mail: { sentAt, sendError: lastError,
          receivedAt: nullable(received?.['received_at']), receiveError: nullable(sync?.['last_error']) },
        notifications: asks.map((row) => ({ id: `ask:${String(row['id'])}`, at: String(row['created_at']),
          kind: String(row['kind']), summary: String(row['question']), askId: String(row['id']) })),
      };
    },
  };
}
