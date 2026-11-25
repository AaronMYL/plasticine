import type { IssueBrief, SubscriptionSettings, SubscriptionView } from '../../api/shared.ts';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_SPAN_DAYS = 6;

export function scheduleText(settings: SubscriptionSettings): string {
  if (settings.kind === 'research') {
    const { every, weekday, time } = settings.schedule;
    return every === 'day' ? `每天 ${time}` : `每周${WEEKDAYS[weekday ?? 1] ?? ''} ${time}`;
  }
  const parts: string[] = [];
  if (settings.daily.on) parts.push(`每天 ${settings.daily.time}`);
  if (settings.weekly.on) parts.push(`每周${WEEKDAYS[settings.weekly.weekday] ?? ''} ${settings.weekly.time}`);
  return parts.join(' · ');
}

export function statusText(status: SubscriptionView['status']): string {
  if (status === 'active') return '已开启';
  if (status === 'paused') return '已暂停';
  return '还没开定时';
}

export function subscriptionLine(view: Pick<SubscriptionView, 'settings' | 'status'>): string {
  const schedule = scheduleText(view.settings);
  return schedule === '' ? statusText(view.status) : `${schedule} · ${statusText(view.status)}`;
}

function parts(date: Date, timeZone?: string): { month: string; day: string } {
  const formatted = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }) }).formatToParts(date);
  const value = (type: string): string => formatted.find((part) => part.type === type)?.value ?? '';
  return { month: value('month'), day: value('day') };
}

export function issueRange(issue: Pick<IssueBrief, 'createdAt' | 'edition'>, timeZone?: string): string {
  const end = new Date(issue.createdAt);
  const last = parts(end, timeZone);
  if (issue.edition === 'daily') {
    return `${last.month}月${last.day}日`;
  }
  const first = parts(new Date(end.getTime() - WEEK_SPAN_DAYS * DAY_MS), timeZone);
  return first.month === last.month ? `${first.month}月${first.day}日–${last.day}日`
    : `${first.month}月${first.day}日–${last.month}月${last.day}日`;
}
