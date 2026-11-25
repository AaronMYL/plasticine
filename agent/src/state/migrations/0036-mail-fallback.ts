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
