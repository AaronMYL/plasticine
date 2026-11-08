// 首页、事列表、记忆目录里的相对时间：刚刚 · n 分钟前 · n 小时前 · 昨天 · n 天前 · 月-日。

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 一周以内写「n 天前」，更早写日期。 */
const RELATIVE_DAYS_MAX = 7;

export function relativeTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const ago = now.getTime() - at.getTime();
  if (ago < MINUTE_MS) {
    return '刚刚';
  }
  if (ago < HOUR_MS) {
    return `${Math.floor(ago / MINUTE_MS)} 分钟前`;
  }
  if (ago < DAY_MS) {
    return `${Math.floor(ago / HOUR_MS)} 小时前`;
  }
  const days = Math.floor(ago / DAY_MS);
  if (days === 1) {
    return '昨天';
  }
  if (days < RELATIVE_DAYS_MAX) {
    return `${days} 天前`;
  }
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}
