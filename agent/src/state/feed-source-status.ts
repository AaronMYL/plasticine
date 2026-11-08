// 每个信息流来源最近一次抓 / 读的结果（迁移 0054）：设置里「信息流来源」那一行据它写出错原因、上次读到的时间；
// 订阅和 X 据 checkedAt 判断到没到下一次（时间由抓取方给，和它判断时用同一个钟）。只覆盖这一行，不改来源行的 version。

import type { StoreContext } from './object-store.ts';

export interface FeedSourceStatus {
  sourceId: string;
  /** 最近一次试着抓 / 读的时间（成没成都算）。 */
  checkedAt: string;
  /** 最近一次成功的时间。 */
  okAt: string | null;
  /** 最近一次没成的原因（中文一句）；成了就清掉。 */
  error: string | null;
  /** 最近一次成功新加了几条。 */
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
    /** 这一次成了：记时间、新加几条，清掉上次的原因。`at` 是抓取方的时钟（它据此算下一次）。 */
    succeeded(sourceId: string, at: string, added: number): void {
      context.db.run(`INSERT INTO feed_source_status (source_id, checked_at, ok_at, error, added)
        VALUES ($id, $at, $at, NULL, $added)
        ON CONFLICT (source_id) DO UPDATE SET checked_at = $at, ok_at = $at, error = NULL, added = $added`,
      { id: sourceId, at, added });
    },
    /** 这一次没成：记时间和原因，上次成功的时间留着。 */
    failed(sourceId: string, at: string, error: string): void {
      context.db.run(`INSERT INTO feed_source_status (source_id, checked_at, ok_at, error, added)
        VALUES ($id, $at, NULL, $error, 0)
        ON CONFLICT (source_id) DO UPDATE SET checked_at = $at, error = $error`,
      { id: sourceId, at, error });
    },
  };
}

export type FeedSourceStatusStore = ReturnType<typeof createFeedSourceStatusStore>;
