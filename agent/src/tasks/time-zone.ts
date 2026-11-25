import { DEFAULT_TIME_ZONE } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';

export type ZoneState = Pick<StateService, 'dailySettings' | 'deviceTimeZones'>;

export function scheduleTimeZone(state: ZoneState): string {
  return state.dailySettings.read().settings.timeZone ?? state.deviceTimeZones.latest()?.timeZone ?? DEFAULT_TIME_ZONE;
}
