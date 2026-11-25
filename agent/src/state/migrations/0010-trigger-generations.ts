import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0010-trigger-generations',
  up(db) {
    db.exec("ALTER TABLE trigger_firings ADD COLUMN trigger_key TEXT NOT NULL DEFAULT ''");
    db.exec('ALTER TABLE trigger_firings ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1)');
    db.exec('ALTER TABLE trigger_firings ADD COLUMN invalidated_at TEXT');
    db.exec('UPDATE trigger_firings SET trigger_key = key');
    db.exec('CREATE UNIQUE INDEX trigger_firings_generation ON trigger_firings (trigger_key, generation)');
  },
};
