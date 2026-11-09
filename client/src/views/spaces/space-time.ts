// 空间的几处时间（第 8 批第 6 条，设计稿 11-09）：资料库卡片下面「来信 · 今天 08:30」、来信信纸顶上「2026 年 11 月 9 日」。
// 一律按本机时区。

import type { SpaceGenre } from '../../api/shared.ts';
import { timeInput } from '../../primitives/message/states.ts';
import { deviceTimeZone } from '../../state/time-zone.ts';

const DAY_MS = 86_400_000;

function parts(iso: string, timeZone: string): { day: string; time: string } {
  const local = timeInput(iso, timeZone);
  return { day: local.slice(0, 10), time: local.slice(11) };
}

/** 「2026 年 11 月 9 日」。 */
export function letterDate(iso: string, timeZone = deviceTimeZone()): string {
  const [year, month, date] = parts(iso, timeZone).day.split('-').map(Number);
  return `${year} 年 ${month} 月 ${date} 日`;
}

/** 「今天 08:30」「昨天 21:07」「11月7日」「2025年11月7日」。 */
export function spaceWhen(iso: string, now: Date, timeZone = deviceTimeZone()): string {
  const { day, time } = parts(iso, timeZone);
  const today = parts(now.toISOString(), timeZone).day;
  if (day === today) return `今天 ${time}`;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  if (day === yesterday) return `昨天 ${time}`;
  const [year, month, date] = day.split('-').map(Number);
  return `${day.slice(0, 4) === today.slice(0, 4) ? '' : `${year}年`}${month}月${date}日`;
}

/** 体裁的名字（卡片下面那一行）；旧版式按报告算。 */
export function genreLabel(genre: SpaceGenre | null): string {
  return genre === 'letter' ? '来信' : '报告';
}
