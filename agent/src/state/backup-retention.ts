// 本机备份留多少（2026-11-13 他定，和别的备份一个规则）：只留最新 2 份，每份从生成那一刻起满 7 天就清；两条同时生效，
// 不够 2 份也照样到期清。原来是「最近 7 天每天一份 + 每周一份留 4 周」（第 116 条，11-04），8 份 700 多兆。
// 生成时间用登记的 createdAt，不看文件时间。没做成的（不是 ready）不占那 2 份的位置，满 7 天清掉。

export const KEEP_COPIES = 2;
export const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRow {
  id: string;
  createdAt: string;
  status: string;
}

/** 到期该清的备份 id。已经清过的不再算。 */
export function expiredBackups(rows: readonly RetentionRow[], now: string): string[] {
  const nowMs = Date.parse(now);
  const fresh = (row: RetentionRow): boolean => nowMs - Date.parse(row.createdAt) < KEEP_DAYS * DAY_MS;
  const live = rows.filter((row) => row.status !== 'expired');
  const kept = new Set(live.filter((row) => row.status === 'ready' && fresh(row))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, KEEP_COPIES).map((row) => row.id));
  return live.filter((row) => (row.status === 'ready' ? !kept.has(row.id) : !fresh(row))).map((row) => row.id);
}
