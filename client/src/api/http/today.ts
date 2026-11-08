// /v2/today/settings 的真实现：日常设置（离开多久算回来等）。2026-11-05 回来汇报和十件事删了，只剩设置。

import type { TodayApi } from '../client.ts';
import {
  CALENDAR_TODAY_PATH, CalendarTodayViewSchema, DailySettingsViewSchema, TODAY_SETTINGS_PATH,
  type CalendarTodayQuery, type CalendarTodayView,
} from '../shared.ts';
import type { DailySettingsView, UpdateDailySettingsRequest } from '../types.ts';
import type { Transport } from './transport.ts';

export class HttpToday implements TodayApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async settings(signal?: AbortSignal): Promise<DailySettingsView> {
    return this.transport.request({ method: 'GET', path: TODAY_SETTINGS_PATH, schema: DailySettingsViewSchema,
      what: '读今日设置', lostAs: 'failed', signal });
  }

  async saveSettings(input: UpdateDailySettingsRequest): Promise<DailySettingsView> {
    return this.transport.request({ method: 'PUT', path: TODAY_SETTINGS_PATH, body: input,
      schema: DailySettingsViewSchema, what: '存今日设置', lostAs: 'uncertain' });
  }

  async calendar(query: CalendarTodayQuery, signal?: AbortSignal): Promise<CalendarTodayView> {
    return this.transport.request({ method: 'GET', path: CALENDAR_TODAY_PATH, query: { ...query },
      schema: CalendarTodayViewSchema, what: '读今天的日程', lostAs: 'failed', signal });
  }
}
