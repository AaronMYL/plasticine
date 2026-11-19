import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { ensureDefaultProjects } from '../../src/projects/index.ts';
import { Tasks } from '../../src/tasks/index.ts';
import { openTestState } from '../state/helpers.ts';
import { startKernel, until, type Harness } from '../lines/helpers.ts';

test('到点后工具取消自己的定时，执行线能写下结果，列表显示已完成', async () => {
  const handle = await openTestState();
  const { state } = handle;
  ensureDefaultProjects(state);
  let h: Harness;
  const tasks = new Tasks({ state, now: () => h.clock.now(),
    scheduleLines: () => ({ open: (input) => h.kernel.open({ ...input, parentLineId: null }).id,
      send: (id, text, origin) => { h.kernel.send(id, { text, origin }); },
      view: (id) => h.kernel.view(id), halt: (id) => { h.kernel.halt(id); } }),
    suggestionLines: () => ({ open: (input) => h.kernel.open({ ...input, parentLineId: null }).id }) });
  h = await startKernel({ handle, tools: tasks.tools(), extra: { turnEnded: (line) => tasks.ended(line.id) } });
  try {
    const desk = tasks.schedules;
    const draft = desk.draft({ title: '明天的提醒', goal: '提醒一次', cadence: { type: 'daily', at: '15:00' },
      projectId: 'project-personal', report: 'failures', place: null, outward: null, replacesId: null,
      draftedBy: 'fixture' });
    const ask = state.asks.create({ kind: 'confirm', purpose: 'line_question', channel: 'popup', question: '提醒？',
      options: [{ id: 'confirm', label: '确认', recommended: true, description: null }] });
    desk.attachAsk(draft.id, ask.id);
    desk.confirm(draft.id, state.asks.update(ask.id, ask.version, { status: 'answered',
      answeredAt: h.clock.now().toISOString(), answeredByDeviceId: 'device-test',
      answer: { optionId: 'confirm', label: '确认', text: null } }));
    h.respond([
      fauxAssistantMessage([fauxToolCall('schedule_change', { scheduleId: draft.id, action: 'remove' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: true })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('本次提醒已完成。'),
    ]);
    h.clock.advance(23 * 60 * 60 * 1000);
    desk.tick();
    const id = desk.require(draft.id).lineId!;
    await until(() => desk.require(draft.id).lastOutcome === 'done', '执行线完成收尾');
    assert.equal(h.kernel.view(id).outcome, 'done');
    assert.equal(h.kernel.view(id).unmet, null);
    assert.equal(desk.require(draft.id).status, 'removed');
    assert.equal(desk.require(draft.id).nextAt, null);
    const last = state.lineMessages.last(id)?.seq;
    h.clock.advance(24 * 60 * 60 * 1000);
    desk.tick();
    assert.equal(state.lineMessages.last(id)?.seq, last);
    assert.equal(state.lineQueue.queued(id).length, 0);
  } finally {
    await h.close();
  }
});
