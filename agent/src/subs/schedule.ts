// 订阅的时间（第 6、7 条）：研究周报按设置里的时间；个人回顾日报每天早上 8 点（接在前一晚做梦之后）、周报周日晚上，
// 都按他所在地的时区（11-07 定）。这里只算「下一次是什么时候」和「这个订阅有哪几个时间」；计时器和到点往后台线里放
// 消息的机制是 tasks 线做的，整合时它读 schedulesOf、到点调 run.ts 的 runSubscription。

import type { SubscriptionSchedule, Subscription, SpaceEdition } from '../../shared/state.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// 往后最多看 8 天就一定碰到「每周某天」的那个时刻（多一天给夏令时那几天留余地）。
const SEARCH_DAYS = 8;

interface WallClock {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short' }).formatToParts(instant);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')),
    weekday: WEEKDAYS.indexOf(value('weekday')) };
}

/** 这个时区里某天某时某分对应的时刻（夏令时跳过的那一刻落到跳过之后）。 */
function zonedInstant(clock: WallClock, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(clock.year, clock.month - 1, clock.day, hour, minute);
  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(instant));
    const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute')) - instant;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/** after 之后（不含）的下一次。 */
export function nextRunAt(schedule: SubscriptionSchedule, timeZone: string, after: Date): Date {
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number];
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const clock = wallClock(new Date(after.getTime() + offset * DAY_MS), timeZone);
    if (schedule.every === 'week' && clock.weekday !== (schedule.weekday ?? 1)) {
      continue;
    }
    const at = zonedInstant(clock, hour, minute, timeZone);
    if (at.getTime() > after.getTime()) {
      return at;
    }
  }
  throw new Error(`算不出下一次的时间：${JSON.stringify(schedule)} @ ${timeZone}`);
}

export interface SubscriptionSlot {
  subscriptionId: string;
  /** 个人回顾分日报、周报；研究周报是 null。 */
  edition: SpaceEdition | null;
  schedule: SubscriptionSchedule;
  timeZone: string;
}

/** 这个订阅按时出的那几个时间；草案、样刊阶段、暂停的都没有（正式开了定时才有）。 */
export function schedulesOf(subscription: Subscription): SubscriptionSlot[] {
  if (subscription.status !== 'active') {
    return [];
  }
  const base = { subscriptionId: subscription.id, timeZone: subscription.timeZone };
  const { settings } = subscription;
  if (settings.kind === 'research') {
    return [{ ...base, edition: null, schedule: settings.schedule }];
  }
  const slots: SubscriptionSlot[] = [];
  if (settings.daily.on) {
    slots.push({ ...base, edition: 'daily', schedule: { every: 'day', time: settings.daily.time } });
  }
  if (settings.weekly.on) {
    slots.push({ ...base, edition: 'weekly',
      schedule: { every: 'week', weekday: settings.weekly.weekday, time: settings.weekly.time } });
  }
  return slots;
}
