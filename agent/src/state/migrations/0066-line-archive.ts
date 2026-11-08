// 归档只隐藏工作，原始线、消息和撤回输入仍可读取与恢复。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0066-line-archive',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN archived_at TEXT');
  },
};
