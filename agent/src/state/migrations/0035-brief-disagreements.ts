import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0035-brief-disagreements',
  up(db) { db.exec('ALTER TABLE brief_items ADD COLUMN disagreement TEXT'); },
};
