import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MateHandoffResponseSchema } from '../../shared/api/mates.ts';
import { Mates } from '../../src/mates/service.ts';
import { systemText } from '../lines/helpers.ts';
import { call, pair, startTestApp } from './helpers.ts';

test('本人领取原任务，执行队友仍能再交接；第二次领取不变成新的委派', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const mates = new Mates(app.state, () => app.app.deps.lines);
    const draft = { name: '资料研究员', role: '整理公开资料', avatar: 'cat' as const, hue: 'sky' as const,
      soul: '核对来源。', purpose: null };
    const first = mates.create(draft);
    const second = mates.create({ ...draft, name: '文字编辑' });
    const group = mates.createGroup({ name: '阅读小组', mateIds: [first.id, second.id] });
    const goal = '核对阅读提纲，并安排文字校对。';
    const created = await call(app, 'POST', `/v2/mate-groups/${group.id}/tasks`, { cookie,
      body: { requestId: 'task-handoff-create', text: goal } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(Value.Check(MateHandoffResponseSchema, created.body));
    const taskId = created.body.line.id;
    let firstTurns = 0;
    app.respond(Array.from({ length: 15 }, () => (context) => {
      const prompt = systemText(context);
      if (prompt.includes('当前身份：资料研究员')) {
        firstTurns += 1;
        return firstTurns === 1 ? fauxAssistantMessage([
          fauxToolCall('mate_handoff', { mateId: second.id, goal: '请校对研究结论。' }, { id: 'task-member-handoff' }),
        ], { stopReason: 'toolUse' }) : fauxAssistantMessage('研究已完成，文字编辑继续校对。');
      }
      return fauxAssistantMessage(prompt.includes('当前身份：文字编辑') ? '文字核对完成。' : '群组结果已汇总。');
    }));
    const claim = await call(app, 'POST', '/v2/mates/handoff', { cookie,
      body: { requestId: 'task-handoff-claim', sourceLineId: taskId, mateId: first.id, groupId: group.id, goal } });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    assert.ok(Value.Check(MateHandoffResponseSchema, claim.body));
    assert.equal(claim.body.line.id, taskId);
    assert.equal(claim.body.line.mateId, first.id);
    await app.app.deps.lines.settled();
    const jobs = app.state.lines.list({ parentLineId: group.lineId, kind: 'background', limit: 20 });
    assert.equal(jobs.length, 2, '执行队友可以继续交给另一位队友');
    assert.equal(jobs.find((line) => line.id === taskId)?.mateId, first.id);
    const delegated = jobs.find((line) => line.id !== taskId);
    assert.equal(delegated?.mateId, second.id);
    assert.equal(app.app.deps.lines.answer(delegated!.id), '文字核对完成。');
    assert.equal((await call(app, 'POST', '/v2/mates/handoff', { cookie,
      body: { requestId: 'task-handoff-claim-again', sourceLineId: taskId,
        mateId: second.id, groupId: group.id, goal } })).status, 409);
    assert.equal(app.state.lines.list({ parentLineId: group.lineId, kind: 'background', limit: 20 }).length, 2);
  } finally { await app.close(); }
});
