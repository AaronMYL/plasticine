// 记忆库三层（《优化清单》第 16 条，11-06 定）：现行 → 归档 → 删除。行上加两列，只加不改：
// - archived_at：被取代的旧说法、过时的事实挪进归档（不再给模型看；问「以前怎么定的」能搜到；永久留着）。
// - deleted_at：他说「忘掉」的（删前出过确认卡）；现行、归档、搜索、对外哪里都不再出现。行本身不删（仓库规矩）。
// 升级不留旧版：已经退休的行按原因归位——用户要忘掉的（forgotten）记删除，其余（被改、被合并、不再成立、他改写）进归档，
// 时间取原来的退休时间。retired_at / retired_reason 照旧保留。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0070-memory-layers',
  up(db) {
    db.exec('ALTER TABLE memory_doc_lines ADD COLUMN archived_at TEXT');
    db.exec('ALTER TABLE memory_doc_lines ADD COLUMN deleted_at TEXT');
    db.exec(`UPDATE memory_doc_lines SET deleted_at = retired_at
      WHERE retired_at IS NOT NULL AND retired_reason = 'forgotten'`);
    db.exec(`UPDATE memory_doc_lines SET archived_at = retired_at
      WHERE retired_at IS NOT NULL AND retired_reason != 'forgotten'`);
    db.exec('CREATE INDEX memory_doc_lines_archive ON memory_doc_lines (archived_at, deleted_at)');
  },
};
