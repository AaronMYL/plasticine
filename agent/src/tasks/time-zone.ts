// 定时按哪个时区算（《优化清单》第 3 条，11-07 定：按他设备当前的时区，出差换地方到点时间跟着变）：
// 设置里明确选了时区的以设置为准（设置写着「不选 = 用当前设备的时区」）；没选就用最近报过时区的那台设备；
// 一台都没报过（刚装好）用北京时间（他在国内，和后台别处的兜底同一个）。

import { DEFAULT_TIME_ZONE } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';

export type ZoneState = Pick<StateService, 'dailySettings' | 'deviceTimeZones'>;

export function scheduleTimeZone(state: ZoneState): string {
  return state.dailySettings.read().settings.timeZone ?? state.deviceTimeZones.latest()?.timeZone ?? DEFAULT_TIME_ZONE;
}
