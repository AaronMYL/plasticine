// 时间一种写法（11-14 界面统一，Aaron 弹框选「按这样写」，设计稿「用词、时间、搜索框、多选、头像」），电脑和手机一样：
// 列表、行、卡片上「什么时候」——1 分钟内「刚刚」· 1 小时内「5 分钟前」· 今天「09:42」· 昨天「昨天」· 一周内「周五」·
// 今年「11-14」· 往年「2025-11-14」。正文里（来信、报告的期数）写「11 月 14 日」，不是今年的带上年。
// 哪天按他所在的时区算（不给就按这台设备的）。

import { timeInput } from '../primitives/message/states.ts';
import { deviceTimeZone } from '../state/time-zone.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 86_400_000;
/** 一周内写星期几（隔 2 到 6 天）。 */
const WEEK_DAYS = 7;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 这一刻在这个时区里是哪天：YYYY-MM-DD。 */
function dayOf(iso: string, timeZone: string): string {
  return timeInput(iso, timeZone).slice(0, 10);
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

export function timeText(iso: string, now: Date, timeZone: string = deviceTimeZone()): string {
  const ago = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ago)) return '';
  if (ago >= 0 && ago < MINUTE_MS) return '刚刚';
  if (ago >= 0 && ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)} 分钟前`;
  const local = timeInput(iso, timeZone);
  const day = local.slice(0, 10);
  const today = dayOf(now.toISOString(), timeZone);
  const gap = dayNumber(today) - dayNumber(day);
  if (gap === 0) return local.slice(11, 16);
  if (gap === 1) return '昨天';
  if (gap > 1 && gap < WEEK_DAYS) return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? day.slice(5);
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
}

/** 正文里的日期：「11 月 14 日」；不是今年的「2025 年 11 月 14 日」。 */
export function bodyDate(iso: string, now: Date = new Date(), timeZone: string = deviceTimeZone()): string {
  const day = dayOf(iso, timeZone);
  if (day === '') return '';
  const [year, month, date] = day.split('-').map(Number);
  const md = `${month} 月 ${date} 日`;
  return day.slice(0, 4) === dayOf(now.toISOString(), timeZone).slice(0, 4) ? md : `${year} 年 ${md}`;
}
