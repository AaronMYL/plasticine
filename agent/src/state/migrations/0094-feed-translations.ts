// 信息流的中文（《优化清单》第 8 条，11-06 定）：抓取时生成的中文译文、中文摘要和小图表，一条条目一行。
// 单独一张表，不加在 feed_items 上：翻译落定不该让条目的 version 往上走（他正点着赞时不撞版本）。
// state：pending 等着翻、done 翻好了、skipped 本来就是简体中文、failed 没翻成（error 写原因，attempts 记次数）。

import type { Migration } from './migrate.ts';
import { inList, jsonColumn } from './sql.ts';

const STATES = ['pending', 'done', 'skipped', 'failed'] as const;

const TABLE = `CREATE TABLE feed_translations (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES feed_items (id),
  state TEXT NOT NULL CHECK (state IN ${inList(STATES)}),
  lang TEXT,
  title TEXT,
  text TEXT,
  digest TEXT,
  ${jsonColumn('chart', true)},
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0094-feed-translations',
  up(db) {
    db.exec(TABLE);
    db.exec('CREATE INDEX feed_translations_state ON feed_translations (state, updated_at)');
  },
};
