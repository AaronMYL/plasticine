import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface LineDayRow {
  lineId: string;
  day: string;
  startSeq: number;
  summary: string | null;
  summarySeq: number;
  compactions: number;
  digest: string | null;
  digestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DayCompaction {
  summary: string | null;
  summarySeq: number;
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
    latest(lineId: string): LineDayRow | undefined {
      const row = db.get('SELECT * FROM line_days WHERE line_id = $lineId ORDER BY day DESC LIMIT 1', { lineId });
      return row === undefined ? undefined : dayOf(row);
    },
    previous(lineId: string, day: string): LineDayRow | undefined {
      const row = db.get(`SELECT * FROM line_days WHERE line_id = $lineId AND day < $day
        ORDER BY day DESC LIMIT 1`, { lineId, day });
      return row === undefined ? undefined : dayOf(row);
    },
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
    undigested(before: string): LineDayRow[] {
      return db.all(`SELECT * FROM line_days WHERE digest IS NULL AND day < $before ORDER BY day, line_id`,
        { before }).map(dayOf);
    },
    setDigest(lineId: string, day: string, digest: string): LineDayRow | undefined {
      const at = context.now();
      db.run(`UPDATE line_days SET digest = $digest, digest_at = $at, updated_at = $at
        WHERE line_id = $lineId AND day = $day`, { lineId, day, digest, at });
      return get(lineId, day);
    },
  };
}

