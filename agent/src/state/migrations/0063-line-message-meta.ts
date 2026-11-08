// 线里每条消息旁边的一点记录（2026-11-05：刷新后「想了 n 秒」和每一步的结果一句要和实时看到的一样）：
// line_messages 加一列 meta（JSON，可空）。回答记想了多少毫秒（thinkingMs），工具结果记那一句结果（summary）。
// 不放进 message 那一列：那一列是 pi 的消息原样，要原样送给模型。只加列，旧行是 NULL。

import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

export const migration: Migration = {
  id: '0063-line-message-meta',
  up(db) {
    db.exec(`ALTER TABLE line_messages ADD COLUMN ${jsonColumn('meta', true)}`);
  },
};
