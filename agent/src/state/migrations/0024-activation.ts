import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0024-activation',
  up(db) {
    db.exec(`CREATE TABLE activation_features (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE activation_feature_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE activation_checks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE activation_decisions (ask_id TEXT PRIMARY KEY, payload TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE migration_checks (
        id TEXT PRIMARY KEY, stage TEXT NOT NULL, passed INTEGER NOT NULL, at TEXT NOT NULL)`);
  },
};
