import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0112-device-local',
  up(db) {
    db.exec('ALTER TABLE devices ADD COLUMN local INTEGER NOT NULL DEFAULT 0 CHECK (local IN (0, 1))');
  },
};
