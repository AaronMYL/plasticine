// 日历和提醒的缓存（第 15 条）：每台 Mac 每种一行，新的一份整份换掉旧的；读最近同步的那一份；形状不对的不写。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { CalendarEvent, NodeInput, ReminderItem } from '../../shared/state.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const AT = '2026-11-08T01:00:00.000Z';

function node(name = '家里的 Mac'): string {
  const input: NodeInput = { name, platform: 'macos', appVersion: '0.9.0', protocolVersion: 1,
    capabilities: ['calendar_list'], credentialHash: name === '家里的 Mac' ? 'a'.repeat(64) : 'c'.repeat(64),
    pairingCodeId: `code-${name}`, pairedAt: AT, lastSeenAt: AT };
  return t.state.nodes.create(input).id;
}

function event(title: string, start = '2026-11-08T06:00:00.000Z'): CalendarEvent {
  return { id: `e-${title}`, title, start, end: '2026-11-08T07:00:00.000Z', allDay: false, location: null,
    notes: null, calendar: '工作', color: '#1BADF8' };
}

const WINDOW = { windowFrom: '2026-11-07T16:00:00.000Z', windowTo: '2026-11-15T16:00:00.000Z' };

test('存一份日程，读回来一样；再存一份整份换掉', () => {
  const mac = node();
  t.state.calendarSnapshots.saveEvents({ nodeId: mac, ...WINDOW, items: [event('产品周会')],
    syncedAt: '2026-11-08T01:00:00.000Z' });
  assert.deepEqual(t.state.calendarSnapshots.latestEvents()?.items.map((item) => item.title), ['产品周会']);
  t.state.calendarSnapshots.saveEvents({ nodeId: mac, ...WINDOW, items: [event('健身'), event('看牙')],
    syncedAt: '2026-11-08T01:10:00.000Z' });
  const latest = t.state.calendarSnapshots.latestEvents();
  assert.deepEqual(latest?.items.map((item) => item.title), ['健身', '看牙']);
  assert.equal(latest?.syncedAt, '2026-11-08T01:10:00.000Z');
  assert.equal(latest?.nodeId, mac);
});

test('提醒单独一行；两台 Mac 取最近同步的那台', () => {
  const home = node();
  const office = node('公司的 Mac');
  const reminder: ReminderItem = { id: 'r1', title: '交房租', due: null, completed: false, notes: null,
    list: '提醒事项' };
  assert.equal(t.state.calendarSnapshots.latestReminders(), undefined);
  t.state.calendarSnapshots.saveReminders({ nodeId: home, ...WINDOW, items: [reminder], syncedAt: AT });
  t.state.calendarSnapshots.saveReminders({ nodeId: office, ...WINDOW, items: [],
    syncedAt: '2026-11-08T02:00:00.000Z' });
  assert.deepEqual(t.state.calendarSnapshots.latestReminders()?.items, []);
  assert.equal(t.state.calendarSnapshots.latestEvents(), undefined);
});

test('形状不对的一份不写', () => {
  const mac = node();
  throwsState(() => t.state.calendarSnapshots.saveEvents({ nodeId: mac, ...WINDOW,
    items: [{ ...event('坏的'), color: 'blue' }], syncedAt: AT }), 'invalid_input');
  assert.equal(t.state.calendarSnapshots.latestEvents(), undefined);
});
