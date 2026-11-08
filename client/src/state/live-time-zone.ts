import type { Live } from '../live.tsx';
import { deviceTimeZone } from './time-zone.ts';

/** 用户设置到达或改动后，替换所有按日/月读取的查询；各 store 作废旧时区的在途结果。 */
export function startTimeZone(live: Live): () => void {
  const apply = () => {
    const zone = live.dailySettings.data.get().settings?.timeZone ?? deviceTimeZone();
    live.feed.setTimeZone(zone);
    live.feedActions.setTimeZone(zone);
    live.m5b.setTimeZone(zone);
    live.timeZone.set(zone);
  };
  const stopSettings = live.dailySettings.data.subscribe(apply);
  const stopResync = live.hub.on((event) => {
    if (event.type === 'resync') {
      void live.dailySettings.reload();
    }
  });
  apply();
  live.dailySettings.open();
  return () => {
    stopSettings();
    stopResync();
  };
}
