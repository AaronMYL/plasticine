import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0077-line-verdict',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN unmet_reason TEXT');
    db.exec('ALTER TABLE lines ADD COLUMN verdict_seq INTEGER');
  },
};
