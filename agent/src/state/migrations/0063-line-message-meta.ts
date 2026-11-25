import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

export const migration: Migration = {
  id: '0063-line-message-meta',
  up(db) {
    db.exec(`ALTER TABLE line_messages ADD COLUMN ${jsonColumn('meta', true)}`);
  },
};
