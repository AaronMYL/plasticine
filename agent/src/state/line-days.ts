// 主线和旁聊按天分段（迁移 0087）：一条线一天一行。只存取：哪天从第几条起、当天压缩到哪、压了几次、那天的要点。
// 什么时候开新的一天、上下文怎么装由 lines/day-context.ts 决定。

import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface LineDayRow {
  lineId: string;
  /** 他所在时区的日子，YYYY-MM-DD。 */
  day: string;
  /** 这一天给模型的上下文从第几条开始。 */
  startSeq: number;
  /** 当天之内压缩的摘要；没压过是 null。 */
  summary: string | null;
  /** 摘要写到第几条（含）；没压过是 0。 */
  summarySeq: number;
  /** 当天写过几次摘要（有上限，见 lines/day-context.ts）。 */
  compactions: number;
  /** 这一天的要点（夜里的做梦写）；还没写是 null。 */
  digest: string | null;
  digestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DayCompaction {
  summary: string | null;
  summarySeq: number;
  /** 这次真的写了摘要（算一次）；只是挪窗口（到上限之后）不算。 */
  counted: boolean;
}

function dayOf(row: Row): LineDayRow {
  const nullable = (key: string): string | null => (row[key] === null || row[key] === undefined ? null
    : String(row[key]));
  return {
    lineId: String(row['line_id']),
    day: String(row['day']),
    startSeq: Number(row['start_seq']),
    summary: nullable('summary'),
    summarySeq: Number(row['summary_seq']),
    compactions: Number(row['compactions']),
    digest: nullable('digest'),
    digestAt: nullable('digest_at'),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function createLineDayStore(context: StoreContext) {
  const { db } = context;
  const get = (lineId: string, day: string): LineDayRow | undefined => {
    const row = db.get('SELECT * FROM line_days WHERE line_id = $lineId AND day = $day', { lineId, day });
    return row === undefined ? undefined : dayOf(row);
  };
  return {
    get,
    /** 最近的一天（现在的上下文就从它起）；还没分过段是 undefined。 */
    latest(lineId: string): LineDayRow | undefined {
      const row = db.get('SELECT * FROM line_days WHERE line_id = $lineId ORDER BY day DESC LIMIT 1', { lineId });
      return row === undefined ? undefined : dayOf(row);
    },
    /** 这一天之前最近的一天（「前一天」：上一次用这条线的那天）。 */
    previous(lineId: string, day: string): LineDayRow | undefined {
      const row = db.get(`SELECT * FROM line_days WHERE line_id = $lineId AND day < $day
        ORDER BY day DESC LIMIT 1`, { lineId, day });
      return row === undefined ? undefined : dayOf(row);
    },
    /** 开新的一天；同一天已经有了就不动（返回已有的）。 */
    start(lineId: string, day: string, startSeq: number): LineDayRow {
      const at = context.now();
      db.run(`INSERT OR IGNORE INTO line_days (line_id, day, start_seq, created_at, updated_at)
        VALUES ($lineId, $day, $startSeq, $at, $at)`, { lineId, day, startSeq, at });
      return get(lineId, day)!;
    },
    compacted(lineId: string, day: string, change: DayCompaction): LineDayRow {
      db.run(`UPDATE line_days SET summary = $summary, summary_seq = $summarySeq,
        compactions = compactions + $counted, updated_at = $at WHERE line_id = $lineId AND day = $day`,
      { lineId, day, summary: change.summary, summarySeq: change.summarySeq, counted: change.counted ? 1 : 0,
        at: context.now() });
      return get(lineId, day)!;
    },
    /** 还没写要点的、今天以前的日子（夜里的做梦从这里挑），旧的在前。 */
    undigested(before: string): LineDayRow[] {
      return db.all(`SELECT * FROM line_days WHERE digest IS NULL AND day < $before ORDER BY day, line_id`,
        { before }).map(dayOf);
    },
    /** 夜里的做梦写这一天的要点（第二天的上下文从记忆库加上它起步）。 */
    setDigest(lineId: string, day: string, digest: string): LineDayRow | undefined {
      const at = context.now();
      db.run(`UPDATE line_days SET digest = $digest, digest_at = $at, updated_at = $at
        WHERE line_id = $lineId AND day = $day`, { lineId, day, digest, at });
      return get(lineId, day);
    },
  };
}

export type LineDayStore = ReturnType<typeof createLineDayStore>;
