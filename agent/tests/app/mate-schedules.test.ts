import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type JsonObject } from '@earendil-works/pi-ai';
import { Mates } from '../../src/mates/service.ts';
import { ensureDefaultProjects } from '../../src/brain/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { until } from '../lines/helpers.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

const draft = { name: '资料研究员', role: '整理公开资料', avatar: '研', hue: 'sky' as const,
  soul: '先核对资料。', purpose: null };
const proposal = { title: '每天核对', goal: '整理公开资料', cadence: { type: 'daily', at: '17:00' },
  outward: { channel: '网页私信', site: 'example.com', recipients: ['纸鹤'],
    content: { kind: 'fixed', texts: ['资料已整理'] }, contentLabel: '固定进度消息' } };

async function confirm(app: TestApp, cookie: string, lineId: string, id: string, args: JsonObject) {
  ensureDefaultProjects(app.state);
  app.state.lines.main();
  app.respond([fauxAssistantMessage([fauxToolCall('schedule_propose', args, { id })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('已记录')]);
  app.app.deps.lines.send(lineId, { text: '建立定时工作' });
  await until(() => app.state.asks.open().length === 1, '出现定时确认卡');
  const ask = app.state.asks.open()[0]!;
  const response = await call(app, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: `confirm-${id}`, optionId: 'confirm' } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  await app.app.deps.lines.settled();
  return app.state.schedules.byDraft(`line:${lineId}:${id}`)!;
}

test('队友定时确认、执行和授权保留同一主体；总管替换未执行任务仍保留原队友，停用后不新跑', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const mates = new Mates(app.state, () => app.app.deps.lines);
    const mate = mates.create(draft);
    app.app.deps.tasks.schedules.tick();
    const old = await confirm(app, cookie, mate.lineId, 'mate-schedule', proposal);
    assert.equal(app.state.outboundGrants.bySchedule(old.id)?.actor, mate.id);
    const replacement = await confirm(app, cookie, MAIN_LINE_ID, 'replace-mate-schedule',
      { ...proposal, title: '每天整理', replacesId: old.id });
    assert.equal(app.state.outboundGrants.bySchedule(replacement.id)?.actor, mate.id);
    app.respond([fauxAssistantMessage('定时整理完成')]);
    app.clock.advance(24 * 60 * 60 * 1000);
    app.app.deps.tasks.schedules.tick();
    await app.app.deps.lines.settled();
    const fired = app.state.schedules.require(replacement.id);
    assert.ok(fired.lineId);
    assert.equal(app.state.lines.require(fired.lineId).mateId, mate.id);
    const count = app.state.lineMessages.after(fired.lineId, 0).length;
    mates.update(mate.id, { version: mate.version, disabled: true });
    app.clock.advance(24 * 60 * 60 * 1000);
    app.app.deps.tasks.schedules.tick();
    await app.app.deps.lines.settled();
    assert.equal(app.state.lineMessages.after(fired.lineId, 0).length, count);
    assert.match(app.state.schedules.require(replacement.id).lastNote ?? '', /停用/);
  } finally { await app.close(); }
});

test('队友不能列出或停开别人的定时任务', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const mates = new Mates(app.state, () => app.app.deps.lines);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    const schedule = await confirm(app, cookie, a.lineId, 'owned-schedule', proposal);
    app.respond([fauxAssistantMessage([fauxToolCall('schedule_list', {}, { id: 'list-other' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('schedule_change', { scheduleId: schedule.id, action: 'pause' },
      { id: 'pause-other' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('schedule_propose', { ...proposal, replacesId: schedule.id },
      { id: 'replace-other' })], { stopReason: 'toolUse' }), fauxAssistantMessage('结束')]);
    app.app.deps.lines.send(b.lineId, { text: '查看定时工作' });
    await app.app.deps.lines.settled();
    const rows = app.state.lineMessages.after(b.lineId, 0).filter((row) => row.role === 'toolResult');
    assert.doesNotMatch(JSON.stringify(rows[0]?.message), new RegExp(schedule.id));
    assert.equal(Reflect.get(rows[1]!.message as object, 'isError'), true);
    assert.equal(Reflect.get(rows[2]!.message as object, 'isError'), true);
    assert.equal(app.state.asks.open().length, 0);
    assert.equal(app.state.schedules.require(schedule.id).status, 'active');
  } finally { await app.close(); }
});

async function convertedChatSchedule(withSnapshot: boolean) {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const mates = new Mates(app.state, () => app.app.deps.lines);
    const old = app.app.deps.lines.openSide({ title: '旧资料讨论', topic: null });
    const schedule = await confirm(app, cookie, old.id, 'old-schedule', proposal);
    if (!withSnapshot) {
      const ask = app.state.asks.require(schedule.confirmAskId!);
      app.state.asks.update(ask.id, ask.version, { context: { lineId: old.id } });
    }
    mates.convert({ lineId: old.id, action: 'mate', draft });
    app.respond([fauxAssistantMessage('整理完成')]);
    app.clock.advance(24 * 60 * 60 * 1000);
    app.app.deps.tasks.schedules.tick();
    await app.app.deps.lines.settled();
    const lineId = app.state.schedules.require(schedule.id).lineId!;
    assert.equal(app.state.lines.require(lineId).mateId, null);
    assert.equal(app.state.outboundGrants.bySchedule(schedule.id)?.actor, MAIN_LINE_ID);
  } finally { await app.close(); }
}

test('旧对话转换不改变已确认定时任务和授权的归属快照', () => convertedChatSchedule(true));
test('没有归属快照的老确认卡也不会变成后来队友的授权', () => convertedChatSchedule(false));
