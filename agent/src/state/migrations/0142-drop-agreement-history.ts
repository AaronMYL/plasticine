import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0142-drop-agreement-history',
  destructive: true,
  changes: ['versions'],
  up(db) {
    db.exec('PRAGMA secure_delete = ON');
    try {
      db.exec("DELETE FROM versions WHERE object_type = 'agreement'");
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
