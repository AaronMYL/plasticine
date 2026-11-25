import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ScheduleInput } from '../../shared/state.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function draft(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { title: '抖音续火花', goal: '给 8 位好友各发一个表情', cadence: { type: 'daily', at: '15:00' },
    projectId: 'project-personal', report: 'failures', place: '你的 Mac',
    outward: { channel: '抖音私信', site: 'douyin.com', recipients: ['小林', '阿杰'], content: { kind: 'emoji' },
      contentLabel: '每人一个表情' },
    replacesId: null, draftedBy: 'line:main:call-1', ...overrides };
}

test('Cron card drafts idempotently, lists in schedule on confirm, queries when due', () => {
  const schedule = t.state.schedules.create(draft());
  assert.equal(schedule.status, 'draft');
  assert.equal(t.state.schedules.byDraft('line:main:call-1')?.id, schedule.id);
  throwsState(() => t.state.schedules.create(draft()), 'duplicate');
  const active = t.state.schedules.update(schedule.id, schedule.version, { status: 'active',
    nextAt: '2026-10-27T07:00:00.000Z', confirmAskId: 'ask-1', confirmedAt: '2026-10-27T06:00:00.000Z',
    confirmedByDeviceId: 'device-1' });
  assert.deepEqual(t.state.schedules.listed().map((row) => row.id), [schedule.id]);
  assert.deepEqual(t.state.schedules.due('2026-10-27T07:00:00.000Z').map((row) => row.id), [active.id]);
  assert.deepEqual(t.state.schedules.due('2026-10-27T06:59:00.000Z'), []);
  assert.equal(t.state.schedules.byAsk('ask-1')?.id, schedule.id);
});

test('Deleting cron marks timestamp only, keeping row while hiding from list', () => {
  const schedule = t.state.schedules.create(draft());
  t.state.schedules.update(schedule.id, schedule.version, { status: 'removed', removedAt: '2026-10-27T09:00:00.000Z' });
  assert.deepEqual(t.state.schedules.listed(), []);
  assert.equal(t.state.schedules.get(schedule.id)?.status, 'removed');
});

test('Scheduled send queries by due occurrence and records one row per invocation', () => {
  const schedule = t.state.schedules.create(draft());
  const send = { scheduleId: schedule.id, confirmAskId: 'ask-1', confirmedByDeviceId: 'device-1', lineId: 'line-9',
    runAt: '2026-10-27T07:00:00.000Z', toolCallId: 'call-7', recipient: '小林', content: '🔥', nodeId: 'node-1',
    tabId: 'tab-1', pageVersion: 'v3', n: 12, op: 'click' as const, pageUrl: 'https://www.douyin.com/chat' };
  const row = t.state.scheduleSends.create(send);
  assert.equal(t.state.scheduleSends.forCall('line-9', 'call-7')?.id, row.id);
  assert.equal(t.state.scheduleSends.forRun(schedule.id, '2026-10-27T07:00:00.000Z').length, 1);
  assert.equal(t.state.scheduleSends.forRun(schedule.id, null).length, 0);
  throwsState(() => t.state.scheduleSends.create(send), 'duplicate');
});

test('Suggestions sort newest-first, query latest by key, log device/time on click', () => {
  const base = { why: '这周你三次提到', goal: '整理成公开页', projectId: null, source: 'plasticine' as const,
    icon: 'file' as const, sourceRef: null };
  const first = t.state.suggestions.create({ ...base, title: '整理悬赏规则', key: 'rules' });
  const second = t.state.suggestions.create({ ...base, title: '回复评审会邀请', key: null });
  assert.deepEqual(t.state.suggestions.open().map((row) => row.id), [second.id, first.id]);
  const acted = t.state.suggestions.update(first.id, first.version, { status: 'dismissed',
    actedAt: '2026-10-27T09:00:00.000Z', actedByDeviceId: 'device-1' });
  assert.equal(acted.status, 'dismissed');
  assert.deepEqual(t.state.suggestions.open().map((row) => row.id), [second.id]);
  assert.equal(t.state.suggestions.byKey('rules')?.id, first.id);
});

test('Device timezone keeps one row per device and uses the most recently reported', () => {
  const mac = t.state.devices.create({ name: 'Mac', firstSeenAt: '2026-10-27T08:00:00.000Z',
    lastSeenAt: '2026-10-27T08:00:00.000Z' });
  const phone = t.state.devices.create({ name: 'iPhone', firstSeenAt: '2026-10-27T08:00:00.000Z',
    lastSeenAt: '2026-10-27T08:00:00.000Z' });
  assert.equal(t.state.deviceTimeZones.latest(), undefined);
  t.state.deviceTimeZones.report(mac.id, 'Asia/Shanghai');
  t.state.deviceTimeZones.report(phone.id, 'Asia/Tokyo');
  assert.equal(t.state.deviceTimeZones.latest()?.timeZone, 'Asia/Tokyo');
  t.state.deviceTimeZones.report(mac.id, 'Europe/Paris');
  assert.equal(t.state.deviceTimeZones.latest()?.timeZone, 'Europe/Paris');
});
