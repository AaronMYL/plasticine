// 信息流条目的中文（0094，《优化清单》第 8 条）：一条条目一行。新条目进来时排成 pending，翻好写 done，简体中文原文写
// skipped，没翻成写 failed（下次扫描按次数退避再试）。不碰 feed_items 的 version。

import { Value } from 'typebox/value';
import { FeedChartSchema, type FeedChart, type FeedZhState } from '../../shared/feed-translation.ts';
import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface FeedTranslationRow {
  itemId: string;
  state: FeedZhState;
  lang: string | null;
  title: string | null;
  text: string | null;
  digest: string | null;
  chart: FeedChart | null;
  error: string | null;
  attempts: number;
  updatedAt: string;
}

export interface FeedTranslationDone {
  lang: string;
  title: string | null;
  text: string | null;
  digest: string | null;
  chart: FeedChart | null;
  model: string | null;
}

/** 没翻成的最多再试这么多次（每次扫描一次），之后留着 failed 等手动再翻。 */
export const FEED_TRANSLATE_ATTEMPTS_MAX = 3;

const STATES: readonly FeedZhState[] = ['pending', 'done', 'skipped', 'failed'];

function stateOf(value: unknown): FeedZhState {
  const found = STATES.find((state) => state === value);
  if (found === undefined) {
    throw new Error(`feed_translations.state 不认识：${String(value)}`);
  }
  return found;
}

function textOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function chartOf(raw: unknown): FeedChart | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  // 存进来时核对过；旧行形状对不上就当没有图，不让整条读失败。
  return Value.Check(FeedChartSchema, parsed) ? parsed : null;
}

function decode(row: Row): FeedTranslationRow {
  return {
    itemId: String(row['item_id']),
    state: stateOf(row['state']),
    lang: textOrNull(row, 'lang'),
    title: textOrNull(row, 'title'),
    text: textOrNull(row, 'text'),
    digest: textOrNull(row, 'digest'),
    chart: chartOf(row['chart']),
    error: textOrNull(row, 'error'),
    attempts: Number(row['attempts']),
    updatedAt: String(row['updated_at']),
  };
}

export function createFeedTranslationStore(context: StoreContext) {
  const get = (itemId: string): FeedTranslationRow | undefined => {
    const row = context.db.get('SELECT * FROM feed_translations WHERE item_id = $id', { id: itemId });
    return row === undefined ? undefined : decode(row);
  };
  const changed = (itemId: string): void => context.index?.changed('feed_item', itemId);
  return {
    get,
    /** 一批条目的中文（列表视图一次读完，不一条一查）。 */
    many(itemIds: readonly string[]): Map<string, FeedTranslationRow> {
      const found = new Map<string, FeedTranslationRow>();
      if (itemIds.length === 0) {
        return found;
      }
      const rows = context.db.all(
        'SELECT * FROM feed_translations WHERE item_id IN (SELECT value FROM json_each($ids))',
        { ids: JSON.stringify(itemIds) });
      for (const row of rows) {
        const decoded = decode(row);
        found.set(decoded.itemId, decoded);
      }
      return found;
    },
    /** 新条目排上；已经有一行的不动（重复入库、迁移重跑都不会重翻）。 */
    queue(itemId: string): void {
      const at = context.now();
      context.db.run(`INSERT INTO feed_translations (item_id, state, created_at, updated_at)
        VALUES ($id, 'pending', $at, $at) ON CONFLICT (item_id) DO NOTHING`, { id: itemId, at });
    },
    /** 下一条要翻的：pending 的先，没翻成且次数没到上限的后；按进来的先后。 */
    next(limit: number): string[] {
      const rows = context.db.all(`SELECT item_id FROM feed_translations
        WHERE state = 'pending' OR (state = 'failed' AND attempts < $max)
        ORDER BY state = 'failed', updated_at, item_id LIMIT $limit`,
      { max: FEED_TRANSLATE_ATTEMPTS_MAX, limit });
      return rows.map((row) => String(row['item_id']));
    },
    finish(itemId: string, done: FeedTranslationDone): void {
      const skipped = done.title === null && done.text === null && done.digest === null && done.chart === null;
      context.db.transaction(() => {
        context.db.run(`UPDATE feed_translations SET state = $state, lang = $lang, title = $title, text = $text,
          digest = $digest, chart = $chart, error = NULL, attempts = attempts + 1, model = $model, updated_at = $at
          WHERE item_id = $id`, {
          id: itemId, state: skipped ? 'skipped' : 'done', lang: done.lang, title: done.title, text: done.text,
          digest: done.digest, chart: done.chart === null ? null : JSON.stringify(done.chart), model: done.model,
          at: context.now(),
        });
        changed(itemId);
      });
    },
    fail(itemId: string, error: string): void {
      context.db.run(`UPDATE feed_translations SET state = 'failed', error = $error, attempts = attempts + 1,
        updated_at = $at WHERE item_id = $id`, { id: itemId, error, at: context.now() });
    },
    /** 没翻成、次数用完的重新排上（他点「再翻一次」或维护时）。 */
    retry(itemId: string): void {
      context.db.run(`UPDATE feed_translations SET state = 'pending', error = NULL, attempts = 0, updated_at = $at
        WHERE item_id = $id AND state = 'failed'`, { id: itemId, at: context.now() });
    },
    /** 还没有中文那一行、在 since 之后进来的条目补排上（升级后的扫描用；不感兴趣的不翻）。返回补了几条。 */
    backfill(since: string, limit: number): number {
      const at = context.now();
      return context.db.run(`INSERT INTO feed_translations (item_id, state, created_at, updated_at)
        SELECT id, 'pending', $at, $at FROM feed_items
        WHERE origin IN ('feed', 'manual') AND (reaction IS NULL OR reaction <> 'dislike')
          AND arrived_at >= $since AND id NOT IN (SELECT item_id FROM feed_translations)
        ORDER BY arrived_at DESC LIMIT $limit`, { at, since, limit });
    },
  };
}

export type FeedTranslationStore = ReturnType<typeof createFeedTranslationStore>;
