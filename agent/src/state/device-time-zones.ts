// 他设备当前的时区（《优化清单》第 3 条，11-07 定）：每台设备打开 Plasticine 时报一次，定时取最近报的那一台。

import type { StoreContext } from './object-store.ts';

export interface DeviceTimeZone {
  deviceId: string;
  timeZone: string;
  reportedAt: string;
}

function read(row: Record<string, unknown> | undefined): DeviceTimeZone | undefined {
  if (row === undefined) {
    return undefined;
  }
  return { deviceId: String(row['device_id']), timeZone: String(row['time_zone']),
    reportedAt: String(row['reported_at']) };
}

export function createDeviceTimeZoneStore(context: StoreContext) {
  return {
    /** 这台设备现在在这个时区（时区名由调用方先核过）。 */
    report(deviceId: string, timeZone: string): DeviceTimeZone {
      const at = context.now();
      context.db.run(`INSERT INTO device_time_zones (device_id, time_zone, reported_at) VALUES ($device, $zone, $at)
        ON CONFLICT (device_id) DO UPDATE SET time_zone = $zone, reported_at = $at`,
      { device: deviceId, zone: timeZone, at });
      return { deviceId, timeZone, reportedAt: at };
    },
    /** 最近报过时区的那台设备；还没有设备报过是 undefined。 */
    latest(): DeviceTimeZone | undefined {
      return read(context.db.get('SELECT * FROM device_time_zones ORDER BY reported_at DESC, device_id LIMIT 1', {}));
    },
  };
}

export type DeviceTimeZoneStore = ReturnType<typeof createDeviceTimeZoneStore>;
