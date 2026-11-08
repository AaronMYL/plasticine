// 首页「今天」（第 15 条）：从缓存挑出今天还没结束的日程、今天到期或过期没做的提醒；没给权限的那一块不出；
// 心跳看接下来两小时里撞在一起的日程。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CalendarEvent, CalendarEventsSnapshot, CalendarRemindersSnapshot, ReminderItem }
  from '../../shared/state.ts';
import { calendarConflicts, calendarToday } from '../../src/calendar/index.ts';

const ZONE = 'Asia/Shanghai';
// 2026-11-08 14:12（北京时间）。
const NOW = new Date('2026-11-08T06:12:00.000Z');

function event(title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: `e-${title}`, title, start, end, allDay: false, location: null, notes: null, calendar: '工作',
    color: '#1BADF8', ...extra };
}

function reminder(title: string, due: string | null, extra: Partial<ReminderItem> = {}): ReminderItem {
  return { id: `r-${title}`, title, due, completed: false, notes: null, list: '提醒事项', dueHasTime: false, ...extra };
}

function events(items: CalendarEvent[], syncedAt = '2026-11-08T06:10:00.000Z'): CalendarEventsSnapshot {
  return { nodeId: 'mac', scope: 'events', windowFrom: '2026-11-07T16:00:00.000Z',
    windowTo: '2026-11-15T16:00:00.000Z', items, syncedAt };
}

function reminders(items: ReminderItem[], syncedAt = '2026-11-08T06:00:00.000Z'): CalendarRemindersSnapshot {
  return { nodeId: 'mac', scope: 'reminders', windowFrom: '2026-11-07T16:00:00.000Z',
    windowTo: '2026-11-15T16:00:00.000Z', items, syncedAt };
}

test('今天还没结束的日程按时间排，全天的在前；明天的和已经结束的不出', () => {
  const view = calendarToday({ now: NOW, zone: ZONE, macOnline: true, calendar: true, reminders: true,
    events: events([
      event('健身', '2026-11-08T11:30:00.000Z', '2026-11-08T12:30:00.000Z', { color: '#63DA38' }),
      event('产品周会', '2026-11-08T06:00:00.000Z', '2026-11-08T07:00:00.000Z'),
      event('早会', '2026-11-08T01:00:00.000Z', '2026-11-08T01:30:00.000Z'),
      event('出差', '2026-11-07T16:00:00.000Z', '2026-11-08T16:00:00.000Z', { allDay: true }),
      event('明天的', '2026-11-09T02:00:00.000Z', '2026-11-09T03:00:00.000Z'),
    ]),
    reminderSnapshot: reminders([]) });
  assert.deepEqual(view.events.map((item) => item.title), ['出差', '产品周会', '健身']);
  assert.equal(view.events[2]?.color, '#63DA38');
  assert.equal(view.events[1]?.key, 'e-产品周会@2026-11-08T06:00:00.000Z');
  assert.equal(view.syncedAt, '2026-11-08T06:00:00.000Z');
});

test('重复日程每一次共用编号：按编号加开始时间区分', () => {
  const view = calendarToday({ now: NOW, zone: ZONE, macOnline: true, calendar: true, reminders: false,
    events: events([
      event('站会', '2026-11-08T07:00:00.000Z', '2026-11-08T07:15:00.000Z', { id: 'same' }),
      event('站会', '2026-11-08T09:00:00.000Z', '2026-11-08T09:15:00.000Z', { id: 'same' }),
    ]) });
  assert.equal(new Set(view.events.map((item) => item.key)).size, 2);
});

test('提醒：今天到期和过期没做的出，没有日期的、以后的、做完的不出', () => {
  const view = calendarToday({ now: NOW, zone: ZONE, macOnline: false, calendar: false, reminders: true,
    reminderSnapshot: reminders([
      reminder('交房租', '2026-11-07T16:00:00.000Z'),
      reminder('上周的', '2026-11-01T16:00:00.000Z'),
      reminder('取快递', '2026-11-08T10:00:00.000Z', { dueHasTime: true }),
      reminder('没日期', null),
      reminder('下周的', '2026-11-12T16:00:00.000Z'),
      reminder('做完了', '2026-11-08T01:00:00.000Z', { completed: true }),
    ]) });
  assert.deepEqual(view.reminderItems.map((item) => [item.title, item.hasTime]),
    [['上周的', false], ['交房租', false], ['取快递', true]]);
  assert.deepEqual(view.events, []);
  assert.equal(view.calendar, false);
  assert.equal(view.macOnline, false);
});

test('没给权限的那一块：缓存里有也不出；都没同步过 syncedAt 是 null', () => {
  const view = calendarToday({ now: NOW, zone: ZONE, macOnline: true, calendar: false, reminders: false,
    events: events([event('产品周会', '2026-11-08T06:00:00.000Z', '2026-11-08T07:00:00.000Z')]) });
  assert.deepEqual(view.events, []);
  assert.equal(view.syncedAt, null);
});

test('接下来两小时里撞在一起的日程：一对一件，全天的不算', () => {
  const items = [
    event('产品周会', '2026-11-08T06:00:00.000Z', '2026-11-08T07:00:00.000Z'),
    event('看牙', '2026-11-08T06:30:00.000Z', '2026-11-08T07:30:00.000Z'),
    event('出差', '2026-11-07T16:00:00.000Z', '2026-11-08T16:00:00.000Z', { allDay: true }),
    event('晚上', '2026-11-08T12:00:00.000Z', '2026-11-08T13:00:00.000Z'),
    event('晚上也撞', '2026-11-08T12:30:00.000Z', '2026-11-08T13:00:00.000Z'),
  ];
  const conflicts = calendarConflicts(items, NOW, new Date(NOW.getTime() + 2 * 60 * 60_000), ZONE);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.text, '日程撞了：14:00–15:00「产品周会」和 14:30–15:30「看牙」');
  assert.equal(conflicts[0]?.id, 'e-产品周会@2026-11-08T06:00:00.000Z|e-看牙@2026-11-08T06:30:00.000Z');
});
