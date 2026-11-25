import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { CalendarSync, calendarTools } from '../../src/calendar/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { FakeDevices, mac } from './helpers.ts';

let t: TestState;
let clock: number;
let devices: FakeDevices;

const START = Date.parse('2026-11-08T06:12:00.000Z');
const SCOPE = { lineId: 'line-main', kind: 'main' as const, projectId: null };
const EVENT = { id: 'e1', title: '产品周会', start: '2026-11-08T06:00:00.000Z', end: '2026-11-08T07:00:00.000Z',
  allDay: false, location: null, notes: null, calendar: '工作' };
const REMINDER = { id: 'r1', title: '交房租', due: '2026-11-07T16:00:00.000Z', completed: false, notes: null,
  list: '提醒事项' };

function tool(name: string): AgentTool {
  const sync = new CalendarSync({ state: t.state, devices, now: () => new Date(clock), zone: () => 'Asia/Shanghai',
    changed: () => undefined });
  const found = calendarTools({ state: t.state, devices, sync, now: () => new Date(clock),
    zone: () => 'Asia/Shanghai' }).find((entry) => entry.name === name);
  assert.ok(found);
  return found.create(SCOPE);
}

async function run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tool(name).execute('call-1', args as never);
  const first = result.content[0];
  assert.ok(first !== undefined && first.type === 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

const RANGE = { from: '2026-11-07T16:00:00.000Z', to: '2026-11-08T16:00:00.000Z' };

beforeEach(async () => {
  t = await openTestState();
  clock = START;
  devices = new FakeDevices();
});

afterEach(async () => {
  await t.cleanup();
});

test('calendar lookup reads live from online Mac with line ID and purpose on action', async () => {
  mac(t.state, new Date(START).toISOString());
  devices.answer = (action) => action.kind === 'calendar_list'
    ? { status: 'executed', result: { events: [EVENT], truncated: false } }
    : { status: 'executed', result: { reminders: [REMINDER, { ...REMINDER, id: 'r2', title: '下周的',
      due: '2026-11-12T16:00:00.000Z' }], truncated: false } };
  const result = await run('calendar_read', RANGE);
  assert.deepEqual(result['events'], [EVENT]);
  assert.deepEqual((result['reminders'] as { title: string }[]).map((item) => item.title), ['交房租']);
  assert.equal(devices.requests[0]?.runId, 'line:line-main');
  assert.equal(devices.requests[0]?.actionId, 'calendar:line-main:call-1');
  assert.deepEqual(devices.requests[0]?.action, { kind: 'calendar_list', ...RANGE });
});

test('calendar lookup reads cache when Mac offline, stating sync time and coverage', async () => {
  const id = mac(t.state, new Date(START - 3 * 60 * 60_000).toISOString());
  t.state.calendarSnapshots.saveEvents({ nodeId: id, windowFrom: '2026-11-07T16:00:00.000Z',
    windowTo: '2026-11-15T16:00:00.000Z', items: [EVENT], syncedAt: '2026-11-08T03:00:00.000Z' });
  const result = await run('calendar_read', RANGE);
  assert.equal(devices.requests.length, 0);
  assert.match(String(result['source']), /不在线/);
  assert.equal(result['eventsSyncedAt'], '11/8 11:00');
  assert.deepEqual(result['events'], [EVENT]);
  const wide = await run('calendar_read', { from: RANGE.from, to: '2026-11-30T16:00:00.000Z' });
  assert.match(String(wide['eventsCover']), /没有完全盖住/);
});

test('create event succeeds only when readback matches, then triggers sync', async () => {
  mac(t.state, new Date(START).toISOString());
  devices.answer = (action) => action.kind === 'calendar_create'
    ? { status: 'executed', result: { eventId: 'new-1', readBack: { title: '看牙', start: '2026-11-09T02:00:00.000Z',
      end: '2026-11-09T03:00:00.000Z', allDay: false } } }
    : { status: 'executed', result: { events: [], reminders: [], truncated: false } };
  const result = await run('calendar_create', { title: '看牙', start: '2026-11-09T10:00:00+08:00',
    end: '2026-11-09T11:00:00+08:00' });
  assert.equal(result['status'], 'done');
  assert.deepEqual(devices.kinds().slice(0, 1), ['calendar_create']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(devices.kinds().includes('calendar_list'), '做完叫了一次同步');
  devices.answer = () => ({ status: 'executed', result: { eventId: 'new-2', readBack: { title: '别的',
    start: '2026-11-09T02:00:00.000Z', end: '2026-11-09T03:00:00.000Z', allDay: false } } });
  await assert.rejects(tool('calendar_create').execute('call-2', { title: '看牙', start: '2026-11-09T10:00:00+08:00',
    end: '2026-11-09T11:00:00+08:00' } as never), /不能证明/);
});

test('create reminder queues when Mac is offline and informs user it is pending', async () => {
  mac(t.state, new Date(START - 60 * 60_000).toISOString());
  devices.answer = () => ({ status: 'queued', result: null, detached: true,
    reason: '「家里的 Mac」现在不在线，已排队：Mac 上线后执行（24 小时内）；还没有做，回执到了才算做了。' });
  const result = await run('reminder_create', { title: '交房租', due: '2026-11-09T09:00:00+08:00' });
  assert.equal(result['status'], 'queued');
  assert.match(String(result['note']), /还没有做/);
  assert.deepEqual(devices.requests[0]?.action, { kind: 'reminder_create', title: '交房租',
    due: '2026-11-09T09:00:00+08:00', notes: null });
});

test('no Mac or missing reminders permission explains where to enable without dispatching action', async () => {
  await assert.rejects(tool('reminder_complete').execute('call-1', { reminderId: 'r1' } as never),
    /还没有连上会读日历的 Mac/);
  mac(t.state, new Date(START).toISOString(), ['calendar_list']);
  await assert.rejects(tool('reminder_complete').execute('call-1', { reminderId: 'r1' } as never),
    /提醒事项的完全访问权限/);
  assert.equal(devices.requests.length, 0);
});
