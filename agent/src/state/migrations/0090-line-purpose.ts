// 开线能指定模型用途（《优化清单》第 13 条接线，第 6 批二段）：研究周报用 researcher、回顾用 review、心跳开的活用
// heartbeat、做梦用 dream。只加列：lines.model_purpose，NULL = 照线的种类取（后台线 agent、主线 main、旁聊 side）。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0090-line-purpose',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN model_purpose TEXT');
  },
};
