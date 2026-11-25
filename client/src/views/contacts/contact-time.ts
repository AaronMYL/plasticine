const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 6;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
  weekday: number;
}

function partsOf(iso: string, timeZone: string | undefined): Parts {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const parts = format.formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: value('hour'),
    minute: value('minute'),
    weekday: Math.max(0, weekdays.indexOf(value('weekday'))),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayGap(a: Parts, b: Parts): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);
}

export function shortDate(iso: string, timeZone?: string): string {
  const parts = partsOf(iso, timeZone);
  return `${pad(parts.month)}-${pad(parts.day)}`;
}

export function clockTime(iso: string, timeZone?: string): string {
  const parts = partsOf(iso, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function dayLabel(iso: string, timeZone?: string): string {
  const parts = partsOf(iso, timeZone);
  return `${pad(parts.month)}-${pad(parts.day)} ${WEEKDAYS[parts.weekday] ?? ''}`.trim();
}

export function dayKey(iso: string, timeZone?: string): string {
  const parts = partsOf(iso, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function deadlineText(iso: string, now: Date, timeZone?: string): string {
  const at = partsOf(iso, timeZone);
  const gap = dayGap(partsOf(now.toISOString(), timeZone), at);
  const clock = `${at.hour}:${at.minute}`;
  if (gap >= 0 && gap <= WEEK_DAYS) {
    return `${WEEKDAYS[at.weekday] ?? ''} ${clock}`;
  }
  return `${pad(at.month)}-${pad(at.day)} ${clock}`;
}
