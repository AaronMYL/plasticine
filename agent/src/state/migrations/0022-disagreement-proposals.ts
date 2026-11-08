import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0022-disagreement-proposals',
  up(db) {
    db.exec('ALTER TABLE disagreement_marks ADD COLUMN proposed_change TEXT');
  },
};
