// 定时按他设备当前的时区算（《优化清单》第 3 条，11-07 定：出差换地方，到点时间自动跟着变）：打开 Plasticine 时报一次
// 这台设备的时区；切回窗口时看一眼，变了再报。没报成只记一句，下次切回来再试（服务端没收到就照旧按上次的算）。

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
