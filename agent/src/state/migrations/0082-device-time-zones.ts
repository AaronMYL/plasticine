// 他设备当前的时区（《优化清单》第 3 条，11-07 定：定时按他设备当前的时区算，出差换地方，到点时间自动跟着变）。
// 每台设备打开 Plasticine 时报一次自己的时区；定时取最近报的那一台（设置里明确选了时区的，以设置为准）。
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
