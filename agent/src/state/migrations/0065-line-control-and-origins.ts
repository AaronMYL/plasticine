// 用户暂停与额度暂停分开；输入的来源跟着队列持久保存。旧消息来源留空，不推断成用户原话。

import type { Migration } from './migrate.ts';
import { booleanColumn, jsonColumn } from './sql.ts';

export const migration: Migration = {
  id: '0065-line-control-and-origins',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN pause_reason TEXT');
    db.exec("UPDATE lines SET pause_reason = 'quota' WHERE status = 'paused'");
    db.exec(`ALTER TABLE lines ADD COLUMN ${booleanColumn('resume_parent', 0)}`);
    db.exec(`ALTER TABLE line_queue ADD COLUMN ${jsonColumn('origin', true)}`);
  },
};
