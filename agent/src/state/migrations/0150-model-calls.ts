import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0150-model-calls',
  up(db) {
    db.exec(`CREATE TABLE model_calls (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      purpose TEXT NOT NULL,
      line_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input INTEGER NOT NULL DEFAULT 0 CHECK (input >= 0),
      cache_read INTEGER NOT NULL DEFAULT 0 CHECK (cache_read >= 0),
      cache_write INTEGER NOT NULL DEFAULT 0 CHECK (cache_write >= 0),
      output INTEGER NOT NULL DEFAULT 0 CHECK (output >= 0),
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0)
    )`);
    db.exec('CREATE INDEX model_calls_created ON model_calls (created_at)');
  },
};
