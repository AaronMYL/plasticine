import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Mates } from '../../src/mates/service.ts';
import { MateGroupTasks, claimPendingGroupTask } from '../../src/mates/group-tasks.ts';
import { mateGroupTaskTools } from '../../src/mates/group-task-tools.ts';
import { openTestState } from '../state/helpers.ts';
import { deferred, slowTool, startKernel, until, type Harness } from './helpers.ts';

const draft = { name: '资料研究员', role: '整理公开资料', avatar: '研', hue: 'sky' as const,
  soul: '先核对原文。', purpose: null };
function setup(h: Harness) {
  const mates = new Mates(h.handle.state, () => h.kernel);
  const a = mates.create(draft);
  const b = mates.create({ ...draft, name: '文字编辑' });
  const c = mates.create({ ...draft, name: '组外队友' });
  const group = mates.createGroup({ name: '资料小组', mateIds: [a.id, b.id] });
  const tasks = new MateGroupTasks(h.handle.state, () => h.kernel);
  const offer = (key: string) => tasks.offer({ groupId: group.id, sourceLineId: group.lineId,
    goal: '整理公开资料并交付摘要', offerKey: key, user: true });
  return { mates, a, b, c, group, tasks, offer };
}

test('群任务创建后等待领取，重放不重复，普通暂停后台线不会被当成群任务', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const { a, group, tasks, offer } = setup(h);
    const task = offer('offer-one');
    assert.equal(offer('offer-one').id, task.id);
    assert.throws(() => tasks.offer({ groupId: group.id, sourceLineId: group.lineId,
      goal: '更换内容', offerKey: 'offer-one', user: true }), /编号/);
    assert.equal(task.mateId, null);
    assert.equal(task.status, 'paused');
    assert.equal(h.handle.state.lineMessages.last(task.id, 'assistant'), undefined);
    assert.equal(tasks.list(group.id).length, 1);
    assert.throws(() => h.kernel.retry(task.id), /领取/);
    assert.throws(() => h.kernel.send(task.id, { text: '绕过领取' }), /领取/);
    const pending = h.kernel.read(task.id, 10).queue[0]!;
    assert.throws(() => h.kernel.sendNow(task.id, pending.id), /领取/);
    assert.equal(h.kernel.read(task.id, 10).queue.length, 1);
    const normal = h.kernel.open({ title: '普通后台工作', goal: '核对', parentLineId: group.lineId, projectId: null });
    h.kernel.halt(normal.id);
    assert.equal(claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: normal.id, mateId: a.id, goal: '核对' }), null);
    assert.equal(tasks.list(group.id).length, 1);
  } finally { await h.close(); }
});

test('同一群任务只被领取一次，完成后交付在群里，私聊不混入其他队友', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await startKernel({ tools: [slowTool(() => gate.promise, started)] });
  try {
    const { a, b, c, group, tasks, offer } = setup(h);
    h.kernel.record(a.lineId, { text: '只在私聊里存放的虚构草稿' });
    const task = offer('offer-claim');
    assert.throws(() => tasks.list(group.id, c.lineId), /群组/);
    assert.throws(() => claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: c.id, goal: '整理公开资料并交付摘要' }), /群组/);
    h.respond([fauxAssistantMessage([fauxToolCall('slow', { what: '群任务' }, { id: 'task-work' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('完整交付：资料摘要。')]);
    const claimed = claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: a.id, goal: '整理公开资料并交付摘要' });
    assert.equal(claimed?.id, task.id);
    await until(() => started.length === 1, '已开始一项群任务');
    assert.throws(() => claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: b.id, goal: '整理公开资料并交付摘要' }), /已经/);
    gate.resolve('已整理');
    await h.kernel.settled();
    assert.equal(tasks.list(group.id, b.lineId)[0]?.outcome, 'done');
    assert.equal(h.kernel.answer(task.id), '完整交付：资料摘要。');
    const report = h.kernel.read(group.lineId, 20).messages.find((row) => row.role === 'lineReport');
    assert.equal(report?.text, '完整交付：资料摘要。');
    assert.equal(h.handle.state.lineMessages.after(a.lineId, 0).length, 1);
    assert.doesNotMatch(JSON.stringify(h.kernel.read(group.lineId, 100)), /只在私聊里存放/);
    assert.doesNotMatch(JSON.stringify(h.kernel.read(task.id, 100)), /只在私聊里存放/);
    assert.equal(h.handle.state.lineMessages.after(b.lineId, 0).length, 0);
    assert.equal(h.handle.state.lineMessages.after(c.lineId, 0).length, 0);
  } finally { gate.resolve('结束'); await h.close(); }
});

test('群任务工具拒绝跨组和封闭来源，模型发布明确保留队友委托来源', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const { a, b, c, mates, group, tasks } = setup(h);
    const other = mates.createGroup({ name: '另一小组', mateIds: [b.id, c.id] });
    assert.throws(() => tasks.list(group.id, other.lineId), /当前群组/);
    assert.throws(() => tasks.offer({ groupId: group.id, sourceLineId: c.lineId,
      goal: '组外发布', offerKey: 'outside-offer' }), /群组/);
    const sealed = h.kernel.open({ title: '封闭对话', goal: '回复来信', parentLineId: null,
      projectId: null, sealedPrompt: '只读本条来信' });
    assert.throws(() => tasks.list(group.id, sealed.id), /封闭/);
    h.kernel.record(a.lineId, { text: '向群组发布核对目标' });
    const task = tasks.offer({ groupId: group.id, sourceLineId: a.lineId, goal: '公开核对目标',
      offerKey: 'actor-offer' });
    const posted = h.handle.state.lineMessages.last(group.lineId)!;
    assert.equal(posted.meta?.origin?.kind, 'delegation');
    assert.equal(posted.meta?.origin?.ref, `line:${a.lineId}:1`);
    assert.equal(h.kernel.read(task.id, 10).queue[0]?.origin.kind, 'delegation');
  } finally { await h.close(); }
});

test('归档任务和停用队友不能领取，普通重试不能把待领任务复活', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const { a, b, mates, offer } = setup(h);
    const archived = offer('offer-archived');
    h.kernel.archive(archived.id);
    assert.equal(offer('offer-archived').id, archived.id);
    const groupId = h.kernel.view(archived.id).mateGroupId!;
    assert.throws(() => new MateGroupTasks(h.handle.state, () => h.kernel).offer({ groupId,
      sourceLineId: h.handle.state.mateGroups.require(groupId).lineId, goal: '整理公开资料并交付摘要',
      offerKey: 'offer-archived', user: true, attachments: ['fictional-changed-attachment'] }), /编号/);
    assert.throws(() => claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: archived.id, mateId: a.id, goal: '整理公开资料并交付摘要' }), /归档/);
    const task = offer('offer-disabled');
    mates.update(b.id, { version: b.version, disabled: true });
    assert.throws(() => claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: b.id, goal: '整理公开资料并交付摘要' }), /停用/);
    assert.equal(h.kernel.view(task.id).mateId, null);
    assert.throws(() => claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: a.id, goal: '偷偷换目标' }), /目标/);
  } finally { await h.close(); }
});

test('重启前异常排队的待领任务不占执行席、不消耗目标，持久标记保留', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const { offer } = setup(h);
    const task = offer('offer-restart');
    h.handle.state.lines.update(task.id, { status: 'queued', pauseReason: null });
    h.kernel.start();
    await h.kernel.settled();
    assert.equal(h.kernel.view(task.id).status, 'paused');
    assert.equal(h.kernel.read(task.id, 10).queue.length, 1);
    assert.equal(h.handle.state.lineMessages.last(task.id, 'assistant'), undefined);
  } finally { await h.close(); }
});

test('四张群任务领取后仍只有三个执行席，第四项排队', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await startKernel({ tools: [slowTool(() => gate.promise, started)] });
  try {
    const { a, offer } = setup(h);
    const tasks = [0, 1, 2, 3].map((i) => offer(`offer-${i}`));
    h.respond(tasks.map((_task, i) => fauxAssistantMessage([
      fauxToolCall('slow', { what: `任务${i}` }, { id: `work-${i}` })], { stopReason: 'toolUse' })));
    for (const task of tasks) claimPendingGroupTask(h.handle.state, h.kernel,
      { sourceLineId: task.id, mateId: a.id, goal: '整理公开资料并交付摘要' });
    await until(() => started.length === 3, '只有三项同时开跑');
    assert.equal(h.kernel.view(tasks[3]!.id).status, 'queued');
    h.respond(Array.from({ length: 8 }, () => fauxAssistantMessage('已交付')));
    gate.resolve('完成');
    await h.kernel.settled();
    assert.equal(h.kernel.view(tasks[3]!.id).status, 'idle');
  } finally { gate.resolve('结束'); await h.close(); }
});

test('队友模型能发布及本人领取群任务，身份取执行线，不能自报别的队友', async () => {
  const handle = await openTestState();
  let h: Harness;
  const tasks = new MateGroupTasks(handle.state, () => h.kernel);
  h = await startKernel({ handle, tools: mateGroupTaskTools(tasks) });
  try {
    const { a, group } = setup(h);
    h.respond([fauxAssistantMessage([fauxToolCall('mate_group_task_create',
      { groupId: group.id, goal: '核对摘要并交付' }, { id: 'create-task' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('任务卡已发布')]);
    h.kernel.send(a.lineId, { text: '在资料小组发布核对任务' });
    await h.kernel.settled();
    const task = tasks.list(group.id)[0]!;
    assert.equal(task.mateId, null);
    assert.equal(task.status, 'paused');
    h.respond([fauxAssistantMessage([fauxToolCall('mate_group_task_claim', { taskId: task.id },
      { id: 'claim-task' })], { stopReason: 'toolUse' }), fauxAssistantMessage('核对结果已交付'),
    fauxAssistantMessage('已领取')]);
    h.kernel.send(a.lineId, { text: '领取刚才的群任务' });
    await h.kernel.settled();
    assert.equal(h.kernel.view(task.id).mateId, a.id);
    assert.equal(h.kernel.view(task.id).outcome, 'done');
  } finally { await h.close(); }
});
