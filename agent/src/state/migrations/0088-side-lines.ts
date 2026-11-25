import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

export const migration: Migration = {
  id: '0088-side-lines',
  up(db) {
    db.exec(`ALTER TABLE lines ADD COLUMN ${jsonColumn('topic', true)}`);
    db.exec('ALTER TABLE lines ADD COLUMN conclusion TEXT');
  },
};
