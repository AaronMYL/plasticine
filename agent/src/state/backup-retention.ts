// 本机备份留多少（第 116 条，用户 2026-11-04 弹框定）：最近 7 天的每一份都留；更早的，每周只留那一周最新的一份、
// 留 4 周；再早的到期清掉。原来是一律留 30 天，数据库还在长，稳定后会到 2G 以上。周按 UTC 的周一起算。

export const DAILY_KEEP_DAYS = 7;
export const WEEKLY_KEEP_WEEKS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRow {
  id: string;
  createdAt: string;
  status: string;
}

/** 这份备份属于哪一周（UTC 周一的日期）。 */
function weekOf(at: string): string {
  const time = new Date(at);
  const sinceMonday = (time.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate() - sinceMonday));
  return monday.toISOString().slice(0, 10);
}

/** 到期该清的备份 id：过了 7 天、又不是那一周最新的一份（或者已经过了 4 周）。已经清过的不再算。 */
export function expiredBackups(rows: readonly RetentionRow[], now: string): string[] {
  const live = rows.filter((row) => row.status !== 'expired');
  const newestOfWeek = new Map<string, RetentionRow>();
  for (const row of live) {
    const week = weekOf(row.createdAt);
    const kept = newestOfWeek.get(week);
    if (kept === undefined || row.createdAt > kept.createdAt) {
      newestOfWeek.set(week, row);
    }
  }
  const nowMs = Date.parse(now);
  return live.filter((row) => {
    const age = nowMs - Date.parse(row.createdAt);
    if (age < DAILY_KEEP_DAYS * DAY_MS) {
      return false;
    }
    const weekly = newestOfWeek.get(weekOf(row.createdAt))?.id === row.id;
    return !(weekly && age < WEEKLY_KEEP_WEEKS * 7 * DAY_MS);
  }).map((row) => row.id);
}
