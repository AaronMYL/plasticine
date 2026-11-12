// 定时线（《优化清单》第 3 条）：起草 → 他确认才生效；到点放一条消息进它自己的后台线；错过的只补最近一次；上一次还没
// 做完就跳过；时区跟着他的设备走；一轮停下记上次结果，按卡上写的告诉他；停、删会停下正在跑的那一轮。

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

test('起草的卡不到点；他在卡上确认才生效，确认记他那张卡和那台设备', () => {
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
  // 北京时间 08:00 确认，今晚 22:00 第一次。
  assert.equal(active.nextAt, '2026-11-08T14:00:00.000Z');
});

test('到点：第一次开它自己的后台线，以后放进同一条线；来源记成这张卡触发的', () => {
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

test('上一次还没做完：这一次跳过，不往线里堆', () => {
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

test('关机三天再开：只补最近的那一次，下次照常', () => {
  const { desk, lines } = setup();
  const schedule = confirmed(desk);
  clock = new Date('2026-11-10T15:00:00Z');
  desk.tick();
  assert.equal(lines.opened.length, 1);
  const after = t.state.schedules.require(schedule.id);
  assert.equal(after.lastRunAt, '2026-11-10T14:00:00.000Z');
  assert.equal(after.nextAt, '2026-11-11T14:00:00.000Z');
});

test('出差换了时区：还没到点的按新时区的同一个钟点重排', () => {
  const { desk } = setup();
  const device = t.state.devices.create({ name: 'Mac', firstSeenAt: clock.toISOString(),
    lastSeenAt: clock.toISOString() });
  t.state.deviceTimeZones.report(device.id, 'Asia/Shanghai');
  const schedule = confirmed(desk);
  desk.tick();
  assert.equal(t.state.schedules.require(schedule.id).nextAt, '2026-11-07T14:00:00.000Z');
  t.state.deviceTimeZones.report(device.id, 'Europe/Paris');
  desk.tick();
  // 巴黎 22:00 = UTC 21:00。
  assert.equal(t.state.schedules.require(schedule.id).nextAt, '2026-11-07T21:00:00.000Z');
});

test('一轮停下：记上次结果；只在没做成时告诉他的卡，做成了不打扰', () => {
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

test('每次都告诉他的卡：做成了也发一条', () => {
  const { desk, lines, notices } = setup();
  confirmed(desk, { report: 'always' });
  clock = new Date('2026-11-07T14:00:10Z');
  desk.tick();
  lines.views.set('line-1', view('line-1', 'idle', { outcome: 'done', lastAnswer: '好了' }));
  desk.ended('line-1');
  assert.equal(notices.length, 1);
  assert.match(notices[0]?.text ?? '', /做完了：好了/);
});

test('停：不再到点，正在跑的那一轮停下；打开从现在起排；删只标记', () => {
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

test('等确认的卡不能拨开关', () => {
  const { desk } = setup();
  const draft = desk.draft(input());
  assert.throws(() => desk.setEnabled(draft.id, true), /还在等你确认/);
});

test('改一张卡：新卡确认后旧卡换掉，定时线接着用旧卡那条', () => {
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

test('一家模型都没连：到点的卡和登记进来的定时都先不跑、不记失败；连上后下一分钟接着跑', () => {
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
