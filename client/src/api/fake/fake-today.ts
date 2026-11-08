// 假的 /v2/today/settings：日常设置，按 requestId 幂等，版本旧了 409。2026-11-05 回来汇报、十件事、今日快照删了，
// 只剩设置。另有假的 /v2/calendar/today（第 15 条）：默认没连 Mac（「今天」一节不出现），seedCalendar 放设计稿那几行。

import type { TodayApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import type { CalendarTodayView } from '../shared.ts';
import type { DailySettingsView, UpdateDailySettingsRequest } from '../types.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeTodayDeps {
  session: FakeSession;
  receipts: FakeReceipts;
}

/** 设置的默认值（shared/state-daily.ts 的默认）。 */
const DEFAULT_SETTINGS: DailySettingsView = {
  briefLimit: 20,
  returnThresholdHours: 4,
  interviewEnabled: true,
  interviewPerDay: 3,
  version: 0,
};

/** 没连过会读日历的 Mac。 */
const NO_CALENDAR: CalendarTodayView = { calendar: false, reminders: false, events: [], reminderItems: [],
  syncedAt: null, macOnline: false };

export class FakeToday implements TodayApi {
  private daily: DailySettingsView = DEFAULT_SETTINGS;
  private calendarView: CalendarTodayView = NO_CALENDAR;
  private readonly deps: FakeTodayDeps;

  constructor(deps: FakeTodayDeps) {
    this.deps = deps;
  }

  async settings(): Promise<DailySettingsView> {
    this.deps.session.require();
    return this.daily;
  }

  async saveSettings(input: UpdateDailySettingsRequest): Promise<DailySettingsView> {
    this.deps.session.require();
    return this.deps.receipts.run('daily_settings', input.requestId, 'PUT /v2/today/settings', () => {
      if (input.version !== this.daily.version) {
        throw new ApiError({
          kind: 'conflict',
          code: 'version_conflict',
          message: '每日设置在别处改过了，这次没有存。',
          next: '重新读一次设置再改。',
          status: 409,
        });
      }
      const { requestId: _requestId, version, ...changes } = input;
      this.daily = { ...this.daily, ...changes, version: version + 1 };
      return this.daily;
    });
  }

  async calendar(): Promise<CalendarTodayView> {
    this.deps.session.require();
    return this.calendarView;
  }

  /** 测试和截图：换一份「今天」。 */
  setCalendar(view: CalendarTodayView): void {
    this.calendarView = view;
  }

  /**
   * 设计稿 Main 那几行：正在开的周会（开了 12 分钟）、晚上 19:30 健身、今天要交的房租。时间跟着现在走，
   * 截图哪个时候截都像设计稿。
   */
  seedCalendar(now: Date): void {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const gym = new Date(now);
    gym.setHours(19, 30, 0, 0);
    if (gym.getTime() <= now.getTime()) {
      gym.setTime(hourStart.getTime() + 3 * 60 * 60_000 + 30 * 60_000);
    }
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const iso = (date: Date): string => date.toISOString();
    this.calendarView = { calendar: true, reminders: true, macOnline: true, syncedAt: iso(now),
      events: [
        { kind: 'event', key: 'e-weekly', title: '产品周会', start: iso(hourStart),
          end: iso(new Date(hourStart.getTime() + 60 * 60_000)), allDay: false, color: '#1BADF8', calendar: '工作' },
        { kind: 'event', key: 'e-gym', title: '健身', start: iso(gym), end: iso(new Date(gym.getTime() + 60 * 60_000)),
          allDay: false, color: '#63DA38', calendar: '生活' },
      ],
      reminderItems: [{ kind: 'reminder', key: 'r-rent', title: '交房租', due: iso(midnight), hasTime: false,
        list: '提醒事项' }] };
  }
}
