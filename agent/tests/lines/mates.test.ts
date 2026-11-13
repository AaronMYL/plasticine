import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { MateDraft } from '../../shared/api/mates.ts';
import { Mates } from '../../src/mates/service.ts';
import { mateTools } from '../../src/mates/tools.ts';
import { openTestState } from '../state/helpers.ts';
import { deferred, scriptByLine, slowTool, startKernel, until } from './helpers.ts';

const draft: MateDraft = { name: '资料研究员', role: '整理公开资料', avatar: 'cat' as const, hue: 'sky',
  soul: '先查原始资料。', purpose: null };

test('主线自动分派的队友晚完成也继续汇总；用户叫停后只收结果', async () => {
  for (const paused of [false, true]) {
    const handle = await openTestState();
    const gate = deferred<string>();
    const started: string[] = [];
    const mates = new Mates(handle.state, () => h.kernel);
    const h = await startKernel({ handle, tools: [...mateTools(mates), slowTool(() => gate.promise, started)] });
    try {
      const mate = mates.create(draft);
      scriptByLine(h, {
        这是主对话: [
          fauxAssistantMessage([fauxToolCall('mate_handoff', { mateId: mate.id, goal: '收集材料' },
            { id: 'handoff-material' })], { stopReason: 'toolUse' }),
          fauxAssistantMessage('材料回来后一起整理。'), fauxAssistantMessage('综合资料，结论已经整理好了。'),
        ],
        '标题「资料研究员 · 收集材料」': [
          fauxAssistantMessage([fauxToolCall('slow', { what: '材料' }, { id: 'slow-material' })],
            { stopReason: 'toolUse' }), fauxAssistantMessage('材料原文和来源。'),
        ],
      });
      h.kernel.send('main', { text: '请安排队友查材料，回来后汇总。' });
      await until(() => started.length === 1 && h.kernel.view('main').status === 'idle',
        '主线结束而队友仍在做');
      if (paused) h.kernel.halt('main');
      gate.resolve('材料齐了');
      await h.kernel.settled();
      assert.equal(h.kernel.view('main').lastAnswer,
        paused ? '材料回来后一起整理。' : '综合资料，结论已经整理好了。');
      assert.equal(h.kernel.view('main').status, paused ? 'paused' : 'idle');
      assert.equal(h.kernel.read('main', 30).messages.filter((message) => message.role === 'lineReport').length, 1);
    } finally { gate.resolve('结束'); await h.close(); }
  }
});

test('队友保持独立对话，交接回发起处，停用后不接受新工作', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const mate = mates.create(draft);
    const other = mates.create({ ...draft, name: '文字编辑', avatar: 'bunny' as const });
    const group = mates.createGroup({ name: '写作小组', mateIds: [mate.id, other.id] });
    const work = mates.handoff({ mateId: mate.id, sourceLineId: group.lineId, goal: '整理背景', groupId: group.id });
    assert.equal(work.mateId, mate.id);
    assert.equal(work.parentLineId, group.lineId);
    assert.equal(work.mateGroupId, group.id);
    assert.equal(h.handle.state.lines.require(mate.lineId).parentLineId, null);
    assert.equal(h.handle.state.lineMessages.after(other.lineId, 0).length, 0);
    mates.update(mate.id, { version: mate.version, disabled: true });
    assert.throws(() => mates.handoff({ mateId: mate.id, sourceLineId: 'main', goal: '整理背景' }), /停用/);
    assert.throws(() => mates.handoff({ mateId: other.id, sourceLineId: mate.lineId, goal: '整理背景' }), /发起/);
    h.kernel.archive(group.lineId);
    assert.throws(() => mates.handoff({ mateId: other.id, sourceLineId: group.lineId, goal: '整理背景' }), /恢复/);
  } finally { await h.close(); }
});

test('和队友直接说话不占后台位置，四位同时开始；模型和授权主体分别继承', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await startKernel({ tools: [slowTool(() => gate.promise, started)] });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const all = [0, 1, 2, 3].map((i) => mates.create({ ...draft, name: `研究队友${i}` }));
    h.respond([0, 1, 2, 3].map((i) => fauxAssistantMessage([
      fauxToolCall('slow', { what: `工作${i}` }, { id: `work-${i}` })], { stopReason: 'toolUse' })));
    for (const mate of all) h.kernel.send(mate.lineId, { text: '开始整理' });
    // 11-12（Aaron 定）：和队友直接说话不占后台位置——人在等它回话，四位都马上开始。
    await until(() => started.length === 4, '四位都已开始');
    assert.equal(h.kernel.view(all[3]!.lineId).status, 'running');
    assert.equal(h.purposes.filter((purpose) => purpose === 'main').length, 4);
    h.respond(Array.from({ length: 8 }, () => fauxAssistantMessage('整理完成。')));
    gate.resolve('资料已就绪');
    await h.kernel.settled();
    assert.equal(h.kernel.view(all[3]!.lineId).status, 'idle');
    assert.equal(h.handle.state.lineQueue.queued(all[3]!.lineId).length, 0);
  } finally { gate.resolve('结束'); await h.close(); }
});

test('主线点名只启动对应队友，保留用户原话并把完整答案以交接消息送回', async () => {
  const h = await startKernel();
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const mate = mates.create(draft);
    const answer = '第一段完整回答。\n\n' + '第二段详细结果。'.repeat(50);
    h.respond([fauxAssistantMessage(answer)]);
    const sent = mates.route('main', { text: '@资料研究员 整理背景', origin: { kind: 'user', userText: '@资料研究员 整理背景' } });
    assert.ok(sent);
    await h.kernel.settled();
    const main = h.kernel.read('main', 20);
    assert.equal(main.messages.filter((row) => row.role === 'assistant').length, 0);
    const report = h.handle.state.lineMessages.after(main.line.id, 0).find((row) => row.role === 'lineReport');
    assert.ok(report);
    assert.equal(Reflect.get(report.message as object, 'text'), answer);
    assert.equal(h.kernel.list({ kind: 'background', limit: 5 })[0]?.mateId, mate.id);
    assert.equal(h.handle.state.lineMessages.after(mate.lineId, 0).length, 0);
  } finally { await h.close(); }
});

test('旧对话只有明确转换后改变归属，原始消息及出处完整保留', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const old = h.kernel.openSide({ title: '旧资料讨论', topic: null });
    const message = { role: 'user', content: '最初的要求', timestamp: 1000 };
    h.handle.state.lineMessages.append(old.id, 'user', message,
      { origin: { kind: 'user', userText: '最初的要求' } });
    assert.equal(mates.list().legacyChats.length, 1);
    const converted = mates.convert({ lineId: old.id, action: 'mate', draft });
    assert.equal(converted.mate?.lineId, old.id);
    assert.deepEqual(h.handle.state.lineMessages.after(old.id, 0)[0]?.message, message);
    assert.equal(mates.list().legacyChats.length, 0);
    assert.throws(() => mates.convert({ lineId: old.id, action: 'merge' }), /已转换/);
  } finally { await h.close(); }
});
