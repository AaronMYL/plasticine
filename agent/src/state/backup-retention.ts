export const KEEP_COPIES = 2;
export const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRow {
  id: string;
  createdAt: string;
  status: string;
}

export function expiredBackups(rows: readonly RetentionRow[], now: string): string[] {
  const nowMs = Date.parse(now);
  const fresh = (row: RetentionRow): boolean => nowMs - Date.parse(row.createdAt) < KEEP_DAYS * DAY_MS;
  const live = rows.filter((row) => row.status !== 'expired');
  const kept = new Set(live.filter((row) => row.status === 'ready' && fresh(row))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, KEEP_COPIES).map((row) => row.id));
  return live.filter((row) => (row.status === 'ready' ? !kept.has(row.id) : !fresh(row))).map((row) => row.id);
}
