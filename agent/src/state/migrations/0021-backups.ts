import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0021-backups',
  up(db) {
    db.exec(`CREATE TABLE backups (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL);
    CREATE TABLE restore_previews (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      backup_id TEXT NOT NULL REFERENCES backups(id), metadata TEXT NOT NULL, patch TEXT NOT NULL,
      confirmation TEXT)`);
  },
};
