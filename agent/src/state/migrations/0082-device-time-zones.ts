import type { Migration } from './migrate.ts';

const ZONES = `CREATE TABLE device_time_zones (
  device_id TEXT PRIMARY KEY NOT NULL REFERENCES devices (id),
  time_zone TEXT NOT NULL,
  reported_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0082-device-time-zones',
  up(db) {
    db.exec(ZONES);
    db.exec('CREATE INDEX device_time_zones_reported ON device_time_zones (reported_at)');
  },
};
