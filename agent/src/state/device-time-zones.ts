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
    report(deviceId: string, timeZone: string): DeviceTimeZone {
      const at = context.now();
      context.db.run(`INSERT INTO device_time_zones (device_id, time_zone, reported_at) VALUES ($device, $zone, $at)
        ON CONFLICT (device_id) DO UPDATE SET time_zone = $zone, reported_at = $at`,
      { device: deviceId, zone: timeZone, at });
      return { deviceId, timeZone, reportedAt: at };
    },
    latest(): DeviceTimeZone | undefined {
      return read(context.db.get('SELECT * FROM device_time_zones ORDER BY reported_at DESC, device_id LIMIT 1', {}));
    },
  };
}

export type DeviceTimeZoneStore = ReturnType<typeof createDeviceTimeZoneStore>;
