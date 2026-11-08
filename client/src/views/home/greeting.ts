// 首页顶上那一行（2026-11-05 他定）：日期「11月5日 星期四」+ 时段问候「早上好，Alex」，名字取网络显示名，
// 取不到就不带名字。按他设的时区算几点。

import { deviceTimeZone } from '../../state/time-zone.ts';

export interface Greeting {
  date: string;
  hello: string;
}

/** 时段的分界（小时，含起点）：5 点起早上、11 点起中午、13 点起下午、18 点起晚上。 */
const PERIODS: ReadonlyArray<{ from: number; text: string }> = [
  { from: 18, text: '晚上好' },
  { from: 13, text: '下午好' },
  { from: 11, text: '中午好' },
  { from: 5, text: '早上好' },
];
const NIGHT = '晚上好';

function hourIn(now: Date, timeZone: string): number {
  const text = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now);
  return Number.parseInt(text, 10);
}

export function greetingOf(now: Date, name: string | null, timeZone = deviceTimeZone()): Greeting {
  const parts = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'long', timeZone })
    .formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = hourIn(now, timeZone);
  const period = PERIODS.find((candidate) => hour >= candidate.from)?.text ?? NIGHT;
  const trimmed = name?.trim() ?? '';
  return {
    date: `${value('month')}月${value('day')}日 ${value('weekday')}`,
    hello: trimmed === '' ? period : `${period}，${trimmed}`,
  };
}
