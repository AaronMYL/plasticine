// 主线和旁聊按天分段（《优化清单》第 17 条，11-06 他定：主线不再拿压缩当记忆）。一条线一天一行：
// - start_seq：这一天给模型的上下文从第几条开始（新的一天第一轮开跑时定下，不在一轮中间切）。
// - summary / summary_seq / compactions：只在当天之内压缩，摘要和次数都记在这一天上，第二天不带过去。
// - digest：这一天的要点，夜里的做梦写；第二天的上下文从记忆库加上前一天的要点起步。
// 只加表；线上旧的 summary 列留着（后台线照旧用它）。

import type { Migration } from './migrate.ts';

const LINE_DAYS = `CREATE TABLE line_days (
  line_id TEXT NOT NULL REFERENCES lines (id),
  day TEXT NOT NULL,
  start_seq INTEGER NOT NULL CHECK (start_seq >= 1),
  summary TEXT,
  summary_seq INTEGER NOT NULL DEFAULT 0 CHECK (summary_seq >= 0),
  compactions INTEGER NOT NULL DEFAULT 0 CHECK (compactions >= 0),
  digest TEXT,
  digest_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_id, day)
)`;

export const migration: Migration = {
  id: '0087-line-days',
  up(db) {
    db.exec(LINE_DAYS);
  },
};
