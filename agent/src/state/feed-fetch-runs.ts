import type { StoreContext } from './object-store.ts';
import { FeedRefreshSchema, type FeedRefresh } from '../../shared/feed-refresh.ts';
import { readRow, type ColumnMap } from './codec.ts';

const REFRESH_COLUMNS: ColumnMap = { requestId: 'text', day: 'text', status: 'text', startedAt: 'text',
  finishedAt: 'text', added: 'integer', error: 'text' };

export function createFeedFetchRuns(context: StoreContext) {
  function refresh(requestId: string): FeedRefresh | undefined {
    const row = context.db.get('SELECT * FROM feed_refresh_runs WHERE request_id = $id', { id: requestId });
    return row === undefined ? undefined : readRow(FeedRefreshSchema, REFRESH_COLUMNS, row, 'feed_refresh_runs');
  }
  return {
    read(day: string): { error: string | null } | undefined {
      const row = context.db.get('SELECT error FROM feed_fetch_runs WHERE day = $day', { day });
      return row === undefined ? undefined : { error: row['error'] === null ? null : String(row['error']) };
    },
    refresh,
    queue(requestId: string, day: string): FeedRefresh {
      context.db.run(`INSERT OR IGNORE INTO feed_refresh_runs (request_id, day, status)
        VALUES ($id, $day, 'queued')`, { id: requestId, day });
      return refresh(requestId) as FeedRefresh;
    },
    next(): FeedRefresh | undefined {
      const row = context.db.get("SELECT * FROM feed_refresh_runs WHERE status = 'queued' ORDER BY rowid LIMIT 1");
      return row === undefined ? undefined : readRow(FeedRefreshSchema, REFRESH_COLUMNS, row, 'feed_refresh_runs');
    },
    claim(requestId: string): boolean {
      return context.db.run(`UPDATE feed_refresh_runs SET status = 'running', started_at = $at
        WHERE request_id = $id AND status = 'queued'`, { id: requestId, at: context.now() }) === 1;
    },
    finishRefresh(requestId: string, added: number, error: string | null, failed = false): void {
      context.db.run(`UPDATE feed_refresh_runs SET status = $status, added = $added, error = $error,
        finished_at = $at WHERE request_id = $id`, { id: requestId, added, error, at: context.now(),
        status: failed ? 'failed' : 'completed' });
    },
    interruptRefreshes(): void {
      context.db.run(`UPDATE feed_refresh_runs SET status = 'failed', finished_at = $at, error = $error
        WHERE status = 'running'`, { at: context.now(), error: '上次刷新中断，结果待核实；可用新请求刷新。' });
    },
    has: (day: string): boolean =>
      context.db.get('SELECT day FROM feed_fetch_runs WHERE day = $day', { day }) !== undefined,
    start: (day: string): boolean => context.db.run(
      'INSERT OR IGNORE INTO feed_fetch_runs (day, started_at) VALUES ($day, $at)', { day, at: context.now() }) === 1,
    finish(day: string, error: string | null): void {
      context.db.run('UPDATE feed_fetch_runs SET finished_at = $at, error = $error WHERE day = $day',
        { day, at: context.now(), error });
    },
  };
}
