import { deviceTimeZone } from '../../state/time-zone.ts';

export interface Greeting {
  date: string;
  hello: string;
}

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
