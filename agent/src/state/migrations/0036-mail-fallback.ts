// 邮件兜底的开关（用户 2026-11-01 定）：一行，和 telemetry_settings 同形；没有行时算开着，所以这里不写默认行。

import type { Migration } from './migrate.ts';
import { booleanColumn, RECORD_COLUMNS } from './sql.ts';

export const migration: Migration = {
  id: '0036-mail-fallback',
  up(db) {
    db.exec(`CREATE TABLE mail_fallback_settings (${RECORD_COLUMNS},
      ${booleanColumn('enabled', 1)}
    )`);
  },
};
