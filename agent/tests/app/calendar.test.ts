// /v2/calendar/today（第 15 条）：首页「今天」在真的服务里读日历缓存；没连 Mac 两块都没有；要本人会话。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CALENDAR_TODAY_PATH, type CalendarTodayView } from '../../shared/api/index.ts';
import { mac } from '../calendar/helpers.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

test('没有本人会话 401；没连 Mac 时日程、提醒两块都没有', async () => {
  const t = await startTestApp();
  apps.push(t);
  assert.equal((await call(t, 'GET', CALENDAR_TODAY_PATH)).status, 401);
  const cookie = await pair(t);
  const reply = await call(t, 'GET', `${CALENDAR_TODAY_PATH}?tz=Asia/Shanghai`, { cookie });
  const view = json(reply) as unknown as CalendarTodayView;
  assert.deepEqual(view, { calendar: false, reminders: false, events: [], reminderItems: [], syncedAt: null,
    macOnline: false });
});

test('Mac 不在线：读缓存里今天的日程和提醒，带上同步时间', async () => {
  const t = await startTestApp();
  apps.push(t);
  const cookie = await pair(t);
  const at = t.clock.now();
  const nodeId = mac(t.state, new Date(at.getTime() - 3 * 60 * 60_000).toISOString());
  const start = new Date(at.getTime() + 60 * 60_000).toISOString();
  const end = new Date(at.getTime() + 2 * 60 * 60_000).toISOString();
  const synced = new Date(at.getTime() - 3 * 60 * 60_000).toISOString();
  t.state.calendarSnapshots.saveEvents({ nodeId, windowFrom: new Date(at.getTime() - 86_400_000).toISOString(),
    windowTo: new Date(at.getTime() + 7 * 86_400_000).toISOString(), syncedAt: synced,
    items: [{ id: 'e1', title: '产品周会', start, end, allDay: false, location: null, notes: null, calendar: '工作',
      color: '#1BADF8' }] });
  const reply = await call(t, 'GET', `${CALENDAR_TODAY_PATH}?tz=UTC`, { cookie });
  const view = json(reply) as unknown as CalendarTodayView;
  assert.equal(view.calendar, true);
  assert.equal(view.macOnline, false);
  assert.equal(view.syncedAt, synced);
  assert.deepEqual(view.events.map((item) => [item.title, item.color]), [['产品周会', '#1BADF8']]);
});
