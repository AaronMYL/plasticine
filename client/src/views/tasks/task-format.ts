// 任务栏目里的时间和图标：下次「15:00」「明天 08:00」「周一 09:00」「11/12 09:00」；在做多久「12 分」；
// 做完多久以前「2 小时前」「昨天」。图标块：定时、建议的图标名对到壳里的图标。

import type { SuggestionView, TimedRowView } from '../../api/shared.ts';
import type { IconName } from '../../shell/icons.tsx';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function parts(iso: string, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(iso));
  const get = (type: string): string => values.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, month: get('month'), date: get('day'),
    clock: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 下次什么时候：今天写钟点，明天写「明天」，一周内写周几，再远写月/日。 */
export function nextText(iso: string, now: Date, timeZone: string): string {
  const at = parts(iso, timeZone);
  const today = parts(now.toISOString(), timeZone).day;
  const tomorrow = parts(new Date(now.getTime() + DAY_MS).toISOString(), timeZone).day;
  if (at.day === today) {
    return at.clock;
  }
  if (at.day === tomorrow) {
    return `明天 ${at.clock}`;
  }
  if (Date.parse(iso) - now.getTime() < 6 * DAY_MS) {
    return `周${WEEKDAYS[WEEKDAY_INDEX[at.weekday] ?? 0]} ${at.clock}`;
  }
  return `${at.month}/${at.date} ${at.clock}`;
}

/** 在做多久：「1 分」「12 分」「2 小时」。 */
export function runningFor(since: string | null, now: number): string | null {
  if (since === null) {
    return null;
  }
  const minutes = Math.max(1, Math.floor((now - Date.parse(since)) / MINUTE_MS));
  return minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 小时`;
}

/** 做完多久以前：「刚才」「12 分钟前」「2 小时前」「昨天」「11/3」。 */
export function agoText(iso: string, now: Date, timeZone: string): string {
  const ms = now.getTime() - Date.parse(iso);
  if (ms < MINUTE_MS) {
    return '刚才';
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)} 分钟前`;
  }
  const at = parts(iso, timeZone);
  if (at.day === parts(now.toISOString(), timeZone).day) {
    return `${Math.floor(ms / HOUR_MS)} 小时前`;
  }
  if (at.day === parts(new Date(now.getTime() - DAY_MS).toISOString(), timeZone).day) {
    return '昨天';
  }
  return `${at.month}/${at.date}`;
}

export function timedIcon(icon: TimedRowView['icon']): IconName {
  return icon === 'space' ? 'chart' : icon;
}

export function ideaIcon(icon: SuggestionView['icon']): IconName {
  return icon === 'space' ? 'chart' : icon;
}

/** 建议的图标块颜色：书是赭石，别的是天蓝（设计稿 Tasks-Ideas）。 */
export function ideaHue(icon: SuggestionView['icon']): 'ochre' | 'sky' {
  return icon === 'books' ? 'ochre' : 'sky';
}
