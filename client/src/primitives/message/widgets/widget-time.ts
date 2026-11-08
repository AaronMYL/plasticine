// 工具卡里的时间和金额怎么写：今天 / 明天 / 周几 + 24 小时制；金额按币种两位小数。都按用户时区。

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function parts(iso: string, timeZone: string): { y: number; m: number; d: number; wd: number; hm: string } {
  const date = new Date(iso);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const map = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map['weekday'] ?? 'Sun');
  return { y: Number(map['year']), m: Number(map['month']), d: Number(map['day']), wd: weekday,
    hm: `${map['hour']}:${map['minute']}` };
}

function dayNumber(value: { y: number; m: number; d: number }): number {
  return Math.round(Date.UTC(value.y, value.m - 1, value.d) / DAY_MS);
}

/** 「今天 12:40」「明天 09:00」「周三 11-12 14:00」，再远写日期。 */
export function dayAndTime(iso: string, now: Date, timeZone: string): string {
  const target = parts(iso, timeZone);
  const today = parts(now.toISOString(), timeZone);
  const offset = dayNumber(target) - dayNumber(today);
  const names: Record<number, string> = { [-1]: '昨天', 0: '今天', 1: '明天', 2: '后天' };
  const name = names[offset];
  if (name !== undefined) {
    return `${name} ${target.hm}`;
  }
  return `${WEEKDAYS[target.wd]} ${target.m}-${target.d} ${target.hm}`;
}

export function clockOf(iso: string, timeZone: string): string {
  return parts(iso, timeZone).hm;
}

/** 一天里的第几分钟（画日历卡的时间条用）。 */
export function minuteOfDay(iso: string, timeZone: string): number {
  const [hour, minute] = parts(iso, timeZone).hm.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}
