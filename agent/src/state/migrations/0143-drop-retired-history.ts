import type { Migration } from './migrate.ts';

const RETIRED = ['task', 'source', 'concern', 'judgment', 'evidence'] as const;

export const migration: Migration = {
  id: '0143-drop-retired-history',
  destructive: true,
  changes: ['versions'],
  up(db) {
    db.exec('PRAGMA secure_delete = ON');
    try {
      db.exec(`DELETE FROM versions WHERE object_type IN (${RETIRED.map((type) => `'${type}'`).join(', ')})`);
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
