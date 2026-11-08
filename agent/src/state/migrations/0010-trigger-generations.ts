// A condition can become false and then true again. Keep every firing and give the next occurrence its own identity.
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0010-trigger-generations',
  up(db) {
    db.exec("ALTER TABLE trigger_firings ADD COLUMN trigger_key TEXT NOT NULL DEFAULT ''");
    db.exec('ALTER TABLE trigger_firings ADD COLUMN generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1)');
    db.exec('ALTER TABLE trigger_firings ADD COLUMN invalidated_at TEXT');
    // Old cards still refer to their original keys; only the new column is filled in.
    db.exec('UPDATE trigger_firings SET trigger_key = key');
    db.exec('CREATE UNIQUE INDEX trigger_firings_generation ON trigger_firings (trigger_key, generation)');
  },
};
