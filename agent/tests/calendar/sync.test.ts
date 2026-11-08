// 日历缓存的同步（第 15 条）：Mac 在线才拉、10 分钟一次、打开首页一分钟最多叫一次；只拉报了能力的那几种；
// 没做成缓存不动。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { cachedConflicts, CalendarSync, syncWindow } from '../../src/calendar/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { FakeDevices, mac } from './helpers.ts';

let t: TestState;
let clock: number;
let devices: FakeDevices;
let changed: number;

const START = Date.parse('2026-11-08T06:12:00.000Z');
const EVENT = { id: 'e1', title: '产品周会', start: '2026-11-08T06:00:00.000Z', end: '2026-11-08T07:00:00.000Z',
  allDay: false, location: null, notes: null, calendar: '工作', color: '#1BADF8' };

function sync(): CalendarSync {
  return new CalendarSync({ state: t.state, devices, now: () => new Date(clock), zone: () => 'Asia/Shanghai',
    changed: () => {
      changed += 1;
    } });
}

beforeEach(async () => {
  t = await openTestState();
  clock = START;
  changed = 0;
  devices = new FakeDevices();
  devices.answer = (action) => action.kind === 'calendar_list'
    ? { status: 'executed', result: { events: [EVENT], truncated: false } }
    : { status: 'executed', result: { reminders: [], truncated: false } };
});

afterEach(async () => {
  await t.cleanup();
});

test('同步的那一段是他所在时区的今天零点起 8 天', () => {
  assert.deepEqual(syncWindow(new Date(START), 'Asia/Shanghai'),
    { from: '2026-11-07T16:00:00.000Z', to: '2026-11-15T16:00:00.000Z' });
});

test('Mac 在线：拉日程和提醒存进缓存，推一次变化；系统发起、写明用途', async () => {
  const id = mac(t.state, new Date(START).toISOString());
  await sync().sync();
  assert.deepEqual(devices.kinds(), ['calendar_list', 'reminder_list']);
  assert.equal(devices.requests[0]?.origin, 'system');
  assert.equal(devices.requests[0]?.nodeId, id);
  assert.match(devices.requests[0]?.purpose ?? '', /同步/);
  assert.deepEqual(t.state.calendarSnapshots.latestEvents()?.items, [EVENT]);
  assert.deepEqual(t.state.calendarSnapshots.latestReminders()?.items, []);
  assert.equal(changed, 1);
});

test('Mac 不在线什么都不发；没给提醒权限只拉日程', async () => {
  mac(t.state, new Date(START - 5 * 60_000).toISOString());
  await sync().sync();
  assert.deepEqual(devices.kinds(), []);
  await t.cleanup();
  t = await (await import('../state/helpers.ts')).openTestState();
  mac(t.state, new Date(START).toISOString(), ['calendar_list']);
  await sync().sync();
  assert.deepEqual(devices.kinds(), ['calendar_list']);
});

test('扫描：上次同步不到 10 分钟不拉；打开首页一分钟最多一次', async () => {
  const seen = (): void => {
    const node = t.state.nodes.list({ limit: 10 })[0];
    assert.ok(node);
    t.state.nodes.update(node.id, node.version, { lastSeenAt: new Date(clock).toISOString() });
  };
  mac(t.state, new Date(START).toISOString());
  const desk = sync();
  await desk.scan();
  assert.equal(devices.requests.length, 2);
  clock += 5 * 60_000;
  seen();
  assert.equal(desk.scan(), null);
  clock += 5 * 60_000;
  seen();
  await desk.scan();
  assert.equal(devices.requests.length, 4);
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
  desk.kick();
  await settle();
  desk.kick();
  await settle();
  assert.equal(devices.requests.length, 6);
  clock += 61_000;
  seen();
  desk.kick();
  await settle();
  assert.equal(devices.requests.length, 8);
});

test('设备没做成或回执形状不对：缓存不动，不推变化', async () => {
  mac(t.state, new Date(START).toISOString());
  devices.answer = (action) => action.kind === 'calendar_list'
    ? { status: 'failed', result: null, reason: '没有日历权限' }
    : { status: 'executed', result: { reminders: 'x' } };
  await sync().sync();
  assert.equal(t.state.calendarSnapshots.latestEvents(), undefined);
  assert.equal(t.state.calendarSnapshots.latestReminders(), undefined);
  assert.equal(changed, 0);
});

test('心跳读缓存看冲突：缓存超过 1 小时没同步就注明几点同步的', () => {
  const id = mac(t.state, new Date(START).toISOString());
  const overlap = { ...EVENT, id: 'e2', title: '看牙', start: '2026-11-08T06:30:00.000Z',
    end: '2026-11-08T07:30:00.000Z' };
  t.state.calendarSnapshots.saveEvents({ nodeId: id, windowFrom: '2026-11-07T16:00:00.000Z',
    windowTo: '2026-11-15T16:00:00.000Z', items: [EVENT, overlap], syncedAt: '2026-11-08T06:00:00.000Z' });
  const port = cachedConflicts(t.state, () => 'Asia/Shanghai', () => new Date(clock));
  const window = [new Date(START), new Date(START + 2 * 60 * 60_000)] as const;
  assert.equal(port.conflicts(...window)[0]?.text, '日程撞了：14:00–15:00「产品周会」和 14:30–15:30「看牙」');
  clock += 2 * 60 * 60_000;
  assert.match(port.conflicts(...window)[0]?.text ?? '', /（日历 14:00 同步的，Mac 现在不在线）$/);
});
