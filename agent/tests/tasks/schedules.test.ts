import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { LineInputOrigin, LineView } from '../../shared/api/index.ts';
import type { Ask, ScheduleInput } from '../../shared/state.ts';
import { ScheduleDesk, type ScheduleLines, type ScheduleNotice } from '../../src/tasks/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let clock: Date;

beforeEach(async () => {
  t = await openTestState();
  clock = new Date('2026-11-07T06:00:00Z');
});

afterEach(async () => {
  await t.cleanup();
});

class FakeLines implements ScheduleLines {
  readonly opened: { title: string; goal: string; projectId: string | null; origin: LineInputOrigin }[] = [];
  readonly sent: { lineId: string; text: string }[] = [];
  readonly halted: string[] = [];
  readonly views = new Map<string, LineView>();

  open(input: { title: string; goal: string; projectId: string | null; origin: LineInputOrigin }): string {
    this.opened.push(input);
    const id = `line-${this.opened.length}`;
    this.views.set(id, view(id, 'queued'));
    return id;
  }

  send(lineId: string, text: string): void {
    this.sent.push({ lineId, text });
  }

  view(lineId: string): LineView | null {
    return this.views.get(lineId) ?? null;
  }

  halt(lineId: string): void {
    this.halted.push(lineId);
  }
}

function view(id: string, status: LineView['status'], extra: Partial<LineView> = {}): LineView {
  return { id, kind: 'background', parentLineId: null, parentMessageSeq: null, projectId: null, title: 't', status,
    pauseReason: null, outcome: null, pausedUntil: null, failure: null, activity: null, activeSince: null, queued: 0,
    lastAnswer: null, unmet: null, createdAt: clock.toISOString(), updatedAt: clock.toISOString(), ...extra };
}

function setup(): { desk: ScheduleDesk; lines: FakeLines; notices: ScheduleNotice[] } {
  const lines = new FakeLines();
  const notices: ScheduleNotice[] = [];
  const desk = new ScheduleDesk({ state: t.state, now: () => clock, lines: () => lines,
    notify: (notice) => notices.push(notice) });
  return { desk, lines, notices };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { title: '同步抖音收藏', goal: '把抖音收藏的标题同步进信息流', cadence: { type: 'daily', at: '22:00' },
    projectId: 'project-personal', report: 'failures', place: null, outward: null, replacesId: null,
    draftedBy: `line:main:${Math.random()}`, ...overrides };
}

function answeredAsk(optionId = 'confirm'): Ask {
  const ask = t.state.asks.create({ kind: 'confirm', purpose: 'line_question', channel: 'popup', question: '定时卡',
    options: [{ id: 'confirm', label: '确认', recommended: true, description: null }] });
  return t.state.asks.update(ask.id, ask.version, { status: 'answered', answeredAt: clock.toISOString(),
    answeredByDeviceId: 'device-mac', answer: { optionId, label: '确认', text: null } });
}

function confirmed(desk: ScheduleDesk, overrides: Partial<ScheduleInput> = {}) {
  const draft = desk.draft(input(overrides));
  const ask = answeredAsk();
  desk.attachAsk(draft.id, ask.id);
  return desk.confirm(draft.id, ask);
}

test('Drafted card does not fire until confirmed; confirm records card and device', () => {
  const { desk, lines } = setup();
  const draft = desk.draft(input());
  clock = new Date('2026-11-08T00:00:00Z');
  desk.tick();
  assert.equal(lines.opened.length, 0);
  const other = answeredAsk();
  const ask = answeredAsk();
  desk.attachAsk(draft.id, ask.id);
  assert.throws(() => desk.confirm(draft.id, other), /不是这张定时卡出的/);
  const active = desk.confirm(draft.id, ask);
  assert.equal(active.status, 'active');
  assert.equal(active.confirmAskId, ask.id);
  assert.equal(active.confirmedByDeviceId, 'device-mac');
  assert.equal(active.nextAt, '2026-11-08T14:00:00.000Z');
});

test('Due card spawns own background line first then reuses it with card source', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  assert.equal(lines.opened.length, 1);
  assert.deepEqual(lines.opened[0]?.origin, { kind: 'trigger', ref: `schedule:${schedule.id}` });
  assert.match(lines.opened[0]?.goal ?? '', /定时任务「同步抖音收藏」到点了（每天 22:00/);
  assert.match(lines.opened[0]?.goal ?? '', /line_outcome/);
  const after = t.state.schedules.require(schedule.id);
  assert.equal(after.lineId, 'line-1');
  assert.equal(after.lastRunAt, '2026-11-07T14:00:00.000Z');
  assert.equal(after.nextAt, '2026-11-08T14:00:00.000Z');
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done' }));
  clock = new Date('2026-11-08T14:00:30Z');
  desk.tick();
  assert.equal(lines.opened.length, 1);
  assert.deepEqual(lines.sent.map((item) => item.lineId), ['line-1']);
});

test('Skips due run when previous run is still active instead of queueing backlog', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'running'));
  clock = new Date('2026-11-08T14:00:10Z');
  desk.tick();
  assert.equal(lines.sent.length, 0);
  const after = t.state.schedules.require(schedule.id);
  assert.equal(after.lastNote, '上一次还没做完，这一次跳过');
  assert.equal(after.nextAt, '2026-11-09T14:00:00.000Z');
});

test('Offline 3 days catches up only latest missed run and resumes normal schedule', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-10T15:00:00Z');
  desk.tick();
  assert.equal(lines.opened.length, 1);
  const after = t.state.schedules.require(schedule.id);
  assert.equal(after.lastRunAt, '2026-11-10T14:00:00.000Z');
  assert.equal(after.nextAt, '2026-11-11T14:00:00.000Z');
});

test('Travel timezone change reschedules unreached run to same local clock time', () => {
  const { desk } = setup();
  const device = t.state.devices.create({ name: 'Mac', firstSeenAt: clock.toISOString(),
    lastSeenAt: clock.toISOString() });
  t.state.deviceTimeZones.report(device.id, 'Asia/Shanghai');
  const schedule = confirmed(desk);
  desk.tick();
  assert.equal(t.state.schedules.require(schedule.id).nextAt, '2026-11-07T14:00:00.000Z');
  t.state.deviceTimeZones.report(device.id, 'Europe/Paris');
  desk.tick();
  assert.equal(t.state.schedules.require(schedule.id).nextAt, '2026-11-07T21:00:00.000Z');
});

test('Run end records result; notify-on-failure card stays silent on success', () => {
  const { desk, lines, notices } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done', lastAnswer: '同步了 12 条收藏' }));
  desk.ended('line-1');
  assert.equal(t.state.schedules.require(schedule.id).lastOutcome, 'done');
  assert.equal(t.state.schedules.require(schedule.id).lastNote, '同步了 12 条收藏');
  assert.equal(notices.length, 0);
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done', unmet: 'Mac 不在线' }));
  desk.ended('line-1');
  assert.equal(t.state.schedules.require(schedule.id).lastOutcome, 'unmet');
  assert.equal(notices.length, 1);
  assert.match(notices[0]?.text ?? '', /这次没做成：Mac 不在线/);
});

test('Always-notify card posts a message even on successful completion', () => {
  const { desk, lines, notices } = setup();
  confirmed(desk, { report: 'always' });
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done', lastAnswer: '好了' }));
  desk.ended('line-1');
  assert.equal(notices.length, 1);
  assert.match(notices[0]?.text ?? '', /做完了：好了/);
});

test('Disable stops active run and pauses schedule; enable schedules from now; del soft', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'running'));
  const paused = desk.setEnabled(schedule.id, false);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.nextAt, null);
  assert.deepEqual(lines.halted, ['line-1']);
  clock = new Date('2026-11-09T00:00:00Z');
  const resumed = desk.setEnabled(schedule.id, true);
  assert.equal(resumed.nextAt, '2026-11-09T14:00:00.000Z');
  const removed = desk.remove(schedule.id);
  assert.equal(removed.status, 'removed');
  assert.equal(t.state.schedules.get(schedule.id)?.status, 'removed');
  assert.deepEqual(t.state.schedules.listed(), []);
});

test('Pending-confirmation card cannot be toggled on or off', () => {
  const { desk } = setup();
  const draft = desk.draft(input());
  assert.throws(() => desk.setEnabled(draft.id, true), /还在等你确认/);
});

test('Editing card replaces old on confirm while keeping the existing schedule line', () => {
  const { desk, lines } = setup();
  const old = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  const changed = confirmed(desk, { cadence: { type: 'daily', at: '23:00' }, replacesId: old.id });
  assert.equal(t.state.schedules.require(old.id).status, 'replaced');
  assert.equal(changed.lineId, 'line-1');
  assert.equal(desk.forLine('line-1')?.id, changed.id);
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done' }));
  clock = new Date('2026-11-08T15:00:10Z');
  desk.tick();
  assert.deepEqual(lines.sent.map((item) => item.lineId), ['line-1']);
});

test('With no model connected, due cards/tasks skip without fail and run once linked', () => {
  const lines = new FakeLines();
  let ready = false;
  const after: Date[] = [];
  const desk = new ScheduleDesk({ state: t.state, now: () => clock, lines: () => lines, ready: () => ready,
    afterTick: (now) => after.push(now) });
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  assert.equal(lines.opened.length, 0);
  assert.equal(after.length, 0);
  const skipped = t.state.schedules.require(schedule.id);
  assert.equal(skipped.lastRunAt, null);
  assert.equal(skipped.lastOutcome, null);
  ready = true;
  clock = new Date('2026-11-07T14:01:10Z');
  desk.tick();
  assert.equal(lines.opened.length, 1);
  assert.equal(after.length, 1);
});

for (const outcome of ['done', 'failed'] as const) {
  test(`Line cancels own next run without interrupting wrap-up, keeping ${outcome}`, () => {
    const { desk, lines, notices } = setup();
    const schedule = confirmed(desk);
    clock = new Date('2026-11-07T14:00:10Z');
    desk.tick();
    lines.views.set('line-1', view('line-1', 'running'));
    const removed = desk.remove(schedule.id, 'line-1');
    assert.deepEqual(lines.halted, []);
    assert.equal(removed.status, 'removed');
    assert.equal(removed.nextAt, null);
    assert.equal(removed.lastOutcome, null);
    lines.views.set('line-1', view('line-1', outcome === 'done' ? 'idle' : 'failed', { outcome }));
    desk.ended('line-1');
    assert.equal(desk.require(schedule.id).lastOutcome, outcome);
    clock = new Date('2026-11-10T15:00:00Z');
    desk.tick();
    desk.tick();
    assert.equal(lines.opened.length, 1);
    assert.deepEqual(lines.sent, []);
    assert.equal(notices.length, outcome === 'done' ? 0 : 1);
  });
}

test('Another line canceling a scheduled task still stops its currently running turn', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'running'));
  desk.remove(schedule.id, 'another-line');
  assert.deepEqual(lines.halted, ['line-1']);
});
