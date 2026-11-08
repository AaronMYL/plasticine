// 2026-11-03：对话里的部件（agent/shared/api/message-widgets.ts）。回复带的部件和它们的答案、状态存在消息自己的
// widgets 列；作答记成的用户消息用 answer_to 指回那个部件。只加不改：旧消息 widgets 是空数组、answer_to 是 NULL。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0044-message-widgets',
  up(db) {
    db.exec(`ALTER TABLE messages ADD COLUMN widgets TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(widgets))`);
    db.exec('ALTER TABLE messages ADD COLUMN answer_to TEXT CHECK (answer_to IS NULL OR json_valid(answer_to))');
  },
};
