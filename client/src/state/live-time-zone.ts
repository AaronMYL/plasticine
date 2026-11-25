import type { Live } from '../live.tsx';
import { deviceTimeZone } from './time-zone.ts';

export function startTimeZone(live: Live): () => void {
  const apply = () => {
    const zone = live.dailySettings.data.get().settings?.timeZone ?? deviceTimeZone();
    live.feed.setTimeZone(zone);
    live.feedActions.setTimeZone(zone);
    live.toolGroups.setTimeZone(zone);
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
