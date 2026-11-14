// 要 Mac 做的事（0095，《优化清单》第 9 条）：翻收藏列表、取一条作品的下载地址。Mac 不在线就一直排着，上线来取；
// 同样的活没了结不另排。从 video-works.ts 分出来（第13批，那个文件过了 500 行）。

import { randomUUID } from 'node:crypto';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface MacJobRow {
  id: string;
  kind: 'list' | 'resolve';
  workId: string | null;
  state: 'waiting' | 'taken' | 'done' | 'failed';
  error: string | null;
  createdAt: string;
  takenAt: string | null;
  finishedAt: string | null;
  full: boolean;
  sequenceBase: number | null;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

/** list 任务复用 work_id 存取数上下文，resolve 任务仍存作品 ID；无需增加任务表字段。 */
function listContext(row: Row): { full: boolean; sequenceBase: number | null } {
  if (row['kind'] !== 'list' || row['work_id'] === null) { return { full: false, sequenceBase: null }; }
  const value: unknown = JSON.parse(String(row['work_id']));
  if (typeof value !== 'object' || value === null || !('full' in value) || !('sequenceBase' in value)
    || typeof value.full !== 'boolean' || !Number.isSafeInteger(value.sequenceBase)) {
    throw new StateError('corrupt_record', '翻收藏任务的顺序上下文无效。');
  }
  return { full: value.full, sequenceBase: Number(value.sequenceBase) };
}

/** 一次取数预留一百万个列表位置，与 DouyinListedWorkSchema 的上限一致。 */
const COLLECTION_SEQUENCE_SPAN = 1_000_000;

function decodeJob(row: Row): MacJobRow {
  const state = (['waiting', 'taken', 'done', 'failed'] as const).find((value) => value === row['state']);
  if (state === undefined) {
    throw new StateError('corrupt_record', `video_mac_jobs.state 不认识：${String(row['state'])}`);
  }
  return {
    id: String(row['id']),
    kind: row['kind'] === 'list' ? 'list' : 'resolve',
    workId: row['kind'] === 'list' ? null : nullableText(row, 'work_id'),
    ...listContext(row),
    state,
    error: nullableText(row, 'error'),
    createdAt: String(row['created_at']),
    takenAt: nullableText(row, 'taken_at'),
    finishedAt: nullableText(row, 'finished_at'),
  };
}

export function createMacJobStore(context: StoreContext) {
  const { db } = context;
  const newListContext = (full: boolean): string => {
    const latestWork = Number(db.get('SELECT MAX(collect_seq) AS n FROM video_works')?.['n'] ?? 0);
    const latestJob = Number(db.get(`SELECT MAX(CASE WHEN json_valid(work_id)
      THEN json_extract(work_id, '$.sequenceBase') END) AS n FROM video_mac_jobs WHERE kind = 'list'`)?.['n'] ?? 0);
    return JSON.stringify({ full, sequenceBase: Math.max(latestWork, latestJob) + COLLECTION_SEQUENCE_SPAN });
  };
  const get = (id: string): MacJobRow | undefined => {
    const row = db.get('SELECT * FROM video_mac_jobs WHERE id = $id', { id });
    return row === undefined ? undefined : decodeJob(row);
  };
  return {
    get,
    /** 排一件；同样的活（同一种、同一条作品）还没了结就不另排，回那一件。 */
    queue(kind: 'list' | 'resolve', workId: string | null, full = false): MacJobRow {
      return db.transaction(() => {
        const open = db.all(`SELECT * FROM video_mac_jobs WHERE kind = $kind
          AND ($kind = 'list' OR work_id IS $work) AND state IN ('waiting', 'taken') ORDER BY created_at`,
        { kind, work: workId }).map(decodeJob).find((job) => kind !== 'list' || !full || job.full);
        if (open !== undefined) { return open; }
        const id = `macjob_${randomUUID()}`;
        const work = kind === 'list' ? newListContext(full) : workId;
        db.run(`INSERT INTO video_mac_jobs (id, kind, work_id, state, created_at)
          VALUES ($id, $kind, $work, 'waiting', $at)`, { id, kind, work, at: context.now() });
        return get(id)!;
      });
    },
    /** Mac 来取：排着的全给；取走超过 staleBefore 还没交回的再给一次（Mac 中途掉线）。 */
    take(staleBefore: string, limit: number): MacJobRow[] {
      return db.transaction(() => {
        const rows = db.all(`SELECT * FROM video_mac_jobs WHERE state = 'waiting'
          OR (state = 'taken' AND taken_at < $stale) ORDER BY created_at LIMIT $limit`,
        { stale: staleBefore, limit }).map(decodeJob);
        for (const job of rows) {
          if (job.kind === 'list' && job.sequenceBase === null) {
            db.run('UPDATE video_mac_jobs SET work_id = $context WHERE id = $id',
              { id: job.id, context: newListContext(true) });
          }
          db.run("UPDATE video_mac_jobs SET state = 'taken', taken_at = $at WHERE id = $id",
            { id: job.id, at: context.now() });
        }
        return rows.map((job) => get(job.id)!);
      });
    },
    finish(id: string, error: string | null): void {
      db.run(`UPDATE video_mac_jobs SET state = $state, error = $error, finished_at = $at
        WHERE id = $id AND state IN ('waiting', 'taken')`,
      { id, state: error === null ? 'done' : 'failed', error, at: context.now() });
    },
    /** 最近一次翻收藏（界面上「上次同步」和这一次在不在等 Mac）。 */
    lastList(): { open: MacJobRow | null; lastDoneAt: string | null; lastFailed: MacJobRow | null } {
      const open = db.get(`SELECT * FROM video_mac_jobs WHERE kind = 'list' AND state IN ('waiting', 'taken')
        ORDER BY created_at DESC LIMIT 1`);
      const done = db.get(`SELECT finished_at FROM video_mac_jobs WHERE kind = 'list' AND state = 'done'
        ORDER BY finished_at DESC LIMIT 1`);
      const latest = db.get(`SELECT * FROM video_mac_jobs WHERE kind = 'list' AND state IN ('done', 'failed')
        ORDER BY finished_at DESC LIMIT 1`);
      const latestJob = latest === undefined ? null : decodeJob(latest);
      return {
        open: open === undefined ? null : decodeJob(open),
        lastDoneAt: done === undefined ? null : nullableText(done, 'finished_at'),
        lastFailed: latestJob?.state === 'failed' ? latestJob : null,
      };
    },
  };
}

export type MacJobStore = ReturnType<typeof createMacJobStore>;
