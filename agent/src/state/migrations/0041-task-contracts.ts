// 第 102 条：交办契约（目标、约束、交付物、卡住怎么办）存在任务上；旧任务是 NULL，照旧能跑完。
// 同一类失败数够三次自动开自迭代，要按种类读全部失败事件：给 task_events 加 (kind, seq) 索引。只加不改。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0041-task-contracts',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN contract TEXT CHECK (contract IS NULL OR json_valid(contract))');
    db.exec('CREATE INDEX task_events_kind ON task_events (kind, seq)');
  },
};
