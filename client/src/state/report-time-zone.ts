import type { TasksApi } from '../api/tasks-client.ts';
import { errorText } from '../api/errors.ts';
import { deviceTimeZone } from './time-zone.ts';

export function startTimeZoneReport(api: Pick<TasksApi, 'reportTimeZone'>,
  zoneOf: () => string = deviceTimeZone): () => void {
  let reported: string | null = null;
  const report = (): void => {
    const zone = zoneOf();
    if (zone === reported) {
      return;
    }
    reported = zone;
    api.reportTimeZone({ timeZone: zone }).catch((cause: unknown) => {
      reported = null;
      console.warn(`没把这台设备的时区报给 Plasticine，下次切回来再报：${errorText(cause)}`);
    });
  };
  const visible = (): void => {
    if (document.visibilityState === 'visible') {
      report();
    }
  };
  report();
  window.addEventListener('focus', report);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('focus', report);
    document.removeEventListener('visibilitychange', visible);
  };
}
