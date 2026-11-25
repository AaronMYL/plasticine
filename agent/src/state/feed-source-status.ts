import type { StoreContext } from './object-store.ts';

export interface FeedSourceStatus {
  sourceId: string;
  checkedAt: string;
  okAt: string | null;
  error: string | null;
  added: number;
}

function statusOf(row: Record<string, unknown>): FeedSourceStatus {
  return {
    sourceId: String(row['source_id']),
    checkedAt: String(row['checked_at']),
    okAt: row['ok_at'] === null ? null : String(row['ok_at']),
    error: row['error'] === null ? null : String(row['error']),
    added: Number(row['added']),
  };
}

export function createFeedSourceStatusStore(context: StoreContext) {
  return {
    read(sourceId: string): FeedSourceStatus | undefined {
      const row = context.db.get('SELECT * FROM feed_source_status WHERE source_id = $id', { id: sourceId });
      return row === undefined ? undefined : statusOf(row);
    },
    all(): Map<string, FeedSourceStatus> {
      const rows = context.db.all('SELECT * FROM feed_source_status');
      return new Map(rows.map((row) => [String(row['source_id']), statusOf(row)]));
    },
    succeeded(sourceId: string, at: string, added: number): void {
      context.db.run(`INSERT INTO feed_source_status (source_id, checked_at, ok_at, error, added)
        VALUES ($id, $at, $at, NULL, $added)
        ON CONFLICT (source_id) DO UPDATE SET checked_at = $at, ok_at = $at, error = NULL, added = $added`,
      { id: sourceId, at, added });
    },
    expire(sourceId: string): void {
      context.db.run('UPDATE feed_source_status SET checked_at = $at WHERE source_id = $id',
        { id: sourceId, at: new Date(0).toISOString() });
    },
    failed(sourceId: string, at: string, error: string): void {
      context.db.run(`INSERT INTO feed_source_status (source_id, checked_at, ok_at, error, added)
        VALUES ($id, $at, NULL, $error, 0)
        ON CONFLICT (source_id) DO UPDATE SET checked_at = $at, error = $error`,
      { id: sourceId, at, error });
    },
  };
}

export type FeedSourceStatusStore = ReturnType<typeof createFeedSourceStatusStore>;
