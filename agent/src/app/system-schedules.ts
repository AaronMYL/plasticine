// 后台「定时」那一节（shared/api/backstage.ts）：服务端自己按钟点跑的几样，和它们真正开跑的条件对齐——
//   本机备份   system/backup-service.ts：按北京时间每天过了 00:00 的第一次检查（每小时一次）建当天那份；自动备份关着不列。
//   抓信息流   daily/external-feed.ts：按每日设置的时区，每天 07:00 起第一次巡检抓一次；没有开着的来源不列。
// 这里不安排、不触发任何事，只读状态算下一次的时间和上一次的出错。钟点改了要两边一起改。

import type { BackstageSchedule } from '../../shared/api/index.ts';
import { BACKGROUND_TIME_ZONE, localDay, localDayStart } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** daily/external-feed.ts FETCH_HOUR。 */
export const FEED_FETCH_HOUR = 7;
/** 备份按北京时间的「今天」（backup-service.ts 写死的时区）。 */
const SHANGHAI = 'Asia/Shanghai';

type ScheduleState = Pick<StateService, 'backups' | 'feedSources' | 'feedFetchRuns' | 'dailySettings'>;

export interface ScheduleOptions {
  state: ScheduleState;
  now: Date;
  /** 自动备份开着没有（assemble 的 automaticBackups）。 */
  automaticBackups: boolean;
}

/** 某个时区里，now 之后第一个 hour 点整（今天的过了就是明天的）。 */
export function nextDailyAt(now: Date, timeZone: string, hour: number): string {
  const today = localDayStart(now, timeZone).getTime() + hour * HOUR_MS;
  if (today > now.getTime()) {
    return new Date(today).toISOString();
  }
  // 跨过夏令时那一天也落在第二天的同一个钟点：先跳到第二天中午再取那天零点。
  const tomorrow = localDayStart(new Date(localDayStart(now, timeZone).getTime() + DAY_MS + 12 * HOUR_MS), timeZone);
  return new Date(tomorrow.getTime() + hour * HOUR_MS).toISOString();
}

function backupSchedule(options: ScheduleOptions): BackstageSchedule | null {
  if (!options.automaticBackups) {
    return null;
  }
  const latest = options.state.backups.list().filter((backup) => backup.reason === 'daily')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    id: 'backup',
    title: '本机备份',
    every: 'daily',
    nextAt: nextDailyAt(options.now, SHANGHAI, 0),
    timeZone: SHANGHAI,
    lastError: latest?.status === 'failed' ? latest.error ?? '没有备份成' : null,
  };
}

function feedSchedule(options: ScheduleOptions): BackstageSchedule | null {
  const { state, now } = options;
  const active = state.feedSources.all()
    .some((source) => (source.kind === 'rss' || source.kind === 'interest') && source.level !== 'off');
  if (!active) {
    return null;
  }
  const timeZone = state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE;
  const today = state.feedFetchRuns.read(localDay(now, timeZone));
  const yesterday = state.feedFetchRuns.read(localDay(new Date(now.getTime() - DAY_MS), timeZone));
  const last = today ?? yesterday;
  return {
    id: 'feed',
    title: '抓信息流',
    every: 'daily',
    nextAt: nextDailyAt(now, timeZone, FEED_FETCH_HOUR),
    timeZone,
    lastError: last?.error ?? null,
  };
}

/** 后台「定时」的几行，按下一次的时间排。 */
export function systemSchedules(options: ScheduleOptions): BackstageSchedule[] {
  return [backupSchedule(options), feedSchedule(options)]
    .filter((row): row is BackstageSchedule => row !== null)
    .sort((a, b) => a.nextAt.localeCompare(b.nextAt));
}
