import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0020-client-updates',
  up(db) {
    db.exec(`CREATE TABLE client_updates (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
    CREATE TABLE client_publications (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)`);
  },
};
