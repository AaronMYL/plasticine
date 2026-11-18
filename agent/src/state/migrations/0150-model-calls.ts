// AI 用量统计（11-18 Aaron：「再在设置-AI 中增加一个AI用量统计」，弹框同意新加这张表）：线上的请求本来就记在
// line_messages 里（每条回答带 usage），旁路调用——笔记续写、输入建议、记忆整理、翻译、对话压缩这些一问一答——原来
// 不记。这张表一次调用一行：什么时候、做什么用、哪家哪个型号、输入、缓存读写、输出、按 API 价估的费用（美元）。
// 只追加，不改不删；从这一版起开始记，以前的没有。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0150-model-calls',
  up(db) {
    db.exec(`CREATE TABLE model_calls (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      purpose TEXT NOT NULL,
      line_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input INTEGER NOT NULL DEFAULT 0 CHECK (input >= 0),
      cache_read INTEGER NOT NULL DEFAULT 0 CHECK (cache_read >= 0),
      cache_write INTEGER NOT NULL DEFAULT 0 CHECK (cache_write >= 0),
      output INTEGER NOT NULL DEFAULT 0 CHECK (output >= 0),
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0)
    )`);
    db.exec('CREATE INDEX model_calls_created ON model_calls (created_at)');
  },
};
