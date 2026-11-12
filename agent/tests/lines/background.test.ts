// 第二级：后台线。开条线去做 → 它自己跑 → 做完把最后那段话贴回发起它的线；同时在跑的有上限（默认 3 条，设置里可调），多的排队。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { deferred, scriptByLine, slowTool, startKernel, until, type Deferred, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(options: Parameters<typeof startKernel>[0] = {}): Promise<Harness> {
  const started = await startKernel(options);
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const MAIN = '这是主对话';

test('开条线去做：主对话不用等；后台线做完把最后那段话贴回主对话，带子线引用', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: [
      fauxAssistantMessage([fauxToolCall('start_line', { title: '查 CuaDriver 的安装来源',
        goal: '查 CuaDriver.app 是从哪装的，写清来源和依据' }, { id: 'spawn-1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('好，开了一条线去慢慢查，查完告诉你。'),
    ],
    '查 CuaDriver 的安装来源': [
      (context) => {
        const first = context.messages.find((message) => message.role === 'user');
        assert.equal(first?.role === 'user' && first.content, '查 CuaDriver.app 是从哪装的，写清来源和依据');
        return fauxAssistantMessage('来源是官方 GitHub Releases，签名是 Cua AI, Inc.。');
      },
    ],
  });
  h.kernel.send('main', { text: '来源这个慢慢查，查完告诉我' });
  await h.kernel.settled();
  const lines = h.kernel.list({ limit: 10 });
  assert.equal(lines.length, 2);
  const child = lines.find((line) => line.kind === 'background');
  assert.equal(child?.parentLineId, MAIN_LINE_ID);
  assert.equal(child?.status, 'idle');
  assert.equal(child?.lastAnswer, '来源是官方 GitHub Releases，签名是 Cua AI, Inc.。');
  const main = h.kernel.read('main', 50).messages;
  const report = main.find((message) => message.role === 'lineReport');
  assert.equal(report?.childLineId, child?.id);
  assert.equal(report?.text, '来源是官方 GitHub Releases，签名是 Cua AI, Inc.。');
  assert.equal(report?.ok, true);
  assert.equal(main.at(-1)?.role, 'lineReport', '贴在主对话最后，没有拆开一组工具调用和结果');
  assert.equal(main.find((message) => message.role === 'toolResult')?.say, '开一条线：查 CuaDriver 的安装来源');
});

test('主对话还在跑时后台线做完：结果插进主对话正在跑的这一轮，模型看得到', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  scriptByLine(h, {
    [MAIN]: [
      fauxAssistantMessage([fauxToolCall('start_line', { title: '后台查', goal: '查一下' }, { id: 's' }),
        fauxToolCall('slow', { what: '主对话自己的事' }, { id: 'w' })], { stopReason: 'toolUse' }),
      (context) => {
        const reported = context.messages.some((message) => message.role === 'user'
          && typeof message.content === 'string' && message.content.includes('后台线「后台查」'));
        return fauxAssistantMessage(reported ? '看到后台线的结果了。' : '没看到。');
      },
    ],
    后台查: [fauxAssistantMessage('查到了。')],
  });
  h.kernel.send('main', { text: '一边查一边做' });
  const child = await (async () => {
    await until(() => h.kernel.list({ kind: 'background', limit: 5 }).some((line) => line.lastAnswer === '查到了。'),
      '后台线做完');
    return h.kernel.list({ kind: 'background', limit: 5 })[0];
  })();
  assert.equal(child?.status, 'idle');
  gate.resolve('做完了');
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').lastAnswer, '看到后台线的结果了。');
  const roles = h.handle.state.lineMessages.after(MAIN_LINE_ID, 0).map((row) => row.role);
  assert.deepEqual(roles, ['user', 'assistant', 'toolResult', 'toolResult', 'lineReport', 'assistant']);
});

test('同时在跑的后台线最多 3 条：第 4 条排队，有一条跑完就接上', async () => {
  const gates: Deferred<string>[] = [deferred(), deferred(), deferred(), deferred()];
  const started: string[] = [];
  let next = 0;
  const h = await harness({ tools: [slowTool(() => {
    const gate = gates[next];
    next += 1;
    return gate?.promise ?? Promise.resolve('多余');
  }, started)] });
  const titles = ['甲', '乙', '丙', '丁'];
  scriptByLine(h, Object.fromEntries(titles.map((title) => [`标题「${title}」`, [
    fauxAssistantMessage([fauxToolCall('slow', { what: title }, { id: `slow-${title}` })], { stopReason: 'toolUse' }),
    fauxAssistantMessage(`${title}做完了`),
  ]])));
  const spawned = titles.map((title) => h.kernel.spawn('main', { title, goal: `做${title}`, projectId: null }));
  assert.deepEqual(spawned.map((line) => line.status), ['running', 'running', 'running', 'queued']);
  assert.equal(spawned[3]?.queued, 1);
  await until(() => started.length === 3, '三条在跑');
  assert.deepEqual(started, ['甲', '乙', '丙']);
  gates[0]?.resolve('好');
  await until(() => started.length === 4, '第四条接上');
  assert.equal(started[3], '丁');
  for (const gate of gates.slice(1)) {
    gate.resolve('好');
  }
  await h.kernel.settled();
  const done = h.kernel.list({ kind: 'background', limit: 10 }).map((line) => line.lastAnswer).sort();
  assert.deepEqual(done, ['丁做完了', '丙做完了', '乙做完了', '甲做完了']);
  const reports = h.kernel.read('main', 50).messages.filter((message) => message.role === 'lineReport');
  assert.equal(reports.length, 4);
});

test('线的工具：看线列表、读一条线、给一条线插话、停一条线', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  const child = h.kernel.spawn('main', { title: '慢慢查', goal: '查', projectId: null });
  scriptByLine(h, {
    '标题「慢慢查」': [
      fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 'c-slow' })], { stopReason: 'toolUse' }),
    ],
    [MAIN]: [
      fauxAssistantMessage([fauxToolCall('list_lines', {}, { id: 'l1' }),
        fauxToolCall('read_line', { lineId: child.id }, { id: 'r1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('tell_line', { lineId: child.id, text: '顺便看版本' }, { id: 't1' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('stop_line', { lineId: child.id }, { id: 'x1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('停了。'),
    ],
  });
  await until(() => h.kernel.view(child.id).activity === '慢慢做：查…', '后台线在跑');
  h.kernel.send('main', { text: '看看后台线，然后停掉它' });
  await until(() => h.kernel.view('main').lastAnswer === '停了。', '主对话答完');
  await h.kernel.settled();
  const results = h.kernel.read('main', 50).messages.filter((message) => message.role === 'toolResult');
  assert.deepEqual(results.map((message) => message.tool), ['list_lines', 'read_line', 'tell_line', 'stop_line']);
  assert.ok(results.every((message) => message.ok === true));
  assert.ok(results[0]?.text.includes('慢慢查'));
  assert.ok(results[2]?.text.includes('"outcome":"steered"'));
  assert.equal(h.kernel.view(child.id).status, 'paused');
  assert.equal(h.kernel.view(child.id).pauseReason, 'user');
  const childRoles = h.handle.state.lineMessages.after(child.id, 0).map((row) => row.role);
  assert.deepEqual(childRoles.slice(0, 3), ['user', 'assistant', 'toolResult']);
  gate.resolve('好');
});

test('封起来的线（替别人答问题）：系统提示只用它自带的那段，一件工具都没有，不贴回任何线', async () => {
  const h = await harness({ tools: [slowTool(async () => '不该被调')] });
  const sealed = '你只替主人答这一个问题。能说的材料：无。';
  h.respond([(context) => {
    const system = context.messages.find((message) => message.role === 'system');
    assert.equal(system?.role === 'system' && system.content, sealed);
    assert.deepEqual(Reflect.get(context, 'tools') ?? [], []);
    return fauxAssistantMessage('{"answer":"周六下午在家","confident":true,"usedMaterialIds":[],"needsOwner":false}');
  }]);
  const line = h.kernel.open({ title: '回 @xiaolin', goal: '他周六下午有空吗？', projectId: null, parentLineId: null,
    sealedPrompt: sealed });
  await until(() => h.kernel.answer(line.id) !== null, '封起来的线答完');
  assert.match(h.kernel.answer(line.id) ?? '', /周六下午在家/);
  assert.equal(h.kernel.read('main', 50).messages.length, 0);
  assert.deepEqual(h.kernel.list({ kind: 'background', limit: 10 }), [],
    '替别人答话的线不进任务列表：回答在聊天里，这里只会看到一段 JSON');
});

test('等他回答的线让出执行位置：三条都停在卡上时，第四条照样开跑；答了以后各自接着做完', async () => {
  const h = await harness();
  const titles = ['甲', '乙', '丙'];
  scriptByLine(h, {
    ...Object.fromEntries(titles.map((title) => [`标题「${title}」`, [
      fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'confirm', question: `${title}现在继续吗？`,
        basis: 'missing', options: [{ id: 'yes', label: '继续', recommended: true }, { id: 'no', label: '先不' }] },
      { id: `ask-${title}` })], { stopReason: 'toolUse' }),
      fauxAssistantMessage(`${title}做完了`),
    ]])),
    '标题「丁」': [fauxAssistantMessage('丁做完了')],
  });
  const waiting = titles.map((title) => h.kernel.spawn('main', { title, goal: `做${title}`, projectId: null }));
  await until(() => waiting.every((line) => h.kernel.view(line.id).status === 'waiting'), '三条都在等他');
  const fourth = h.kernel.spawn('main', { title: '丁', goal: '做丁', projectId: null });
  assert.equal(fourth.status, 'running', '等回答的线不占位置');
  await until(() => h.kernel.view(fourth.id).lastAnswer === '丁做完了', '第四条做完');
  assert.ok(waiting.every((line) => h.kernel.view(line.id).status === 'waiting'), '等着的三条原样等着');
  for (const ask of h.handle.state.asks.open()) {
    h.desk.answer({ askId: ask.id, optionId: 'yes', answerer: { deviceId: 'd' } });
  }
  await h.kernel.settled();
  const done = h.kernel.list({ kind: 'background', limit: 10 }).map((line) => line.lastAnswer).sort();
  assert.deepEqual(done, ['丁做完了', '丙做完了', '乙做完了', '甲做完了']);
});

test('排着队的线在别的线开始等他回答时接上，不用等谁做完', async () => {
  const gates: Deferred<string>[] = [deferred(), deferred()];
  let next = 0;
  const h = await harness({ tools: [slowTool(() => gates[next++]?.promise ?? Promise.resolve('多余'))] });
  scriptByLine(h, {
    '标题「问」': [
      fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'confirm', question: '现在继续吗？', basis: 'missing',
        options: [{ id: 'yes', label: '继续', recommended: true }, { id: 'no', label: '先不' }] }, { id: 'ask-q' })],
      { stopReason: 'toolUse' }),
      fauxAssistantMessage('问做完了'),
    ],
    ...Object.fromEntries(['慢一', '慢二'].map((title) => [`标题「${title}」`, [
      fauxAssistantMessage([fauxToolCall('slow', { what: title }, { id: `slow-${title}` })], { stopReason: 'toolUse' }),
      fauxAssistantMessage(`${title}做完了`),
    ]])),
    '标题「后来的」': [fauxAssistantMessage('后来的做完了')],
  });
  const asking = h.kernel.spawn('main', { title: '问', goal: '做问', projectId: null });
  h.kernel.spawn('main', { title: '慢一', goal: '做慢一', projectId: null });
  h.kernel.spawn('main', { title: '慢二', goal: '做慢二', projectId: null });
  const late = h.kernel.spawn('main', { title: '后来的', goal: '做后来的', projectId: null });
  await until(() => h.kernel.view(asking.id).status === 'waiting', '第一条在等他');
  await until(() => h.kernel.view(late.id).lastAnswer === '后来的做完了', '排队的那条接上并做完');
  for (const gate of gates) {
    gate.resolve('好');
  }
  for (const ask of h.handle.state.asks.open()) {
    h.desk.answer({ askId: ask.id, optionId: 'yes', answerer: { deviceId: 'd' } });
  }
  await h.kernel.settled();
});

test('替别人答话的封闭线不排在长任务后面：三条慢任务占满时照样马上答', async () => {
  const gates: Deferred<string>[] = [deferred(), deferred(), deferred()];
  let next = 0;
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gates[next++]?.promise ?? Promise.resolve('多余'), started)] });
  const titles = ['甲', '乙', '丙'];
  scriptByLine(h, {
    ...Object.fromEntries(titles.map((title) => [`标题「${title}」`, [
      fauxAssistantMessage([fauxToolCall('slow', { what: title }, { id: `slow-${title}` })], { stopReason: 'toolUse' }),
      fauxAssistantMessage(`${title}做完了`),
    ]])),
    '只替主人答这一个问题': [fauxAssistantMessage('{"answer":"在家","confident":true,"usedMaterialIds":[],"needsOwner":false}')],
  });
  for (const title of titles) {
    h.kernel.spawn('main', { title, goal: `做${title}`, projectId: null });
  }
  await until(() => started.length === 3, '三条慢任务占满');
  const reply = h.kernel.open({ title: '回 @xiaolin', goal: '他在家吗？', projectId: null, parentLineId: null,
    sealedPrompt: '只替主人答这一个问题。' });
  await until(() => h.kernel.answer(reply.id) !== null, '封闭线马上答完');
  for (const gate of gates) {
    gate.resolve('好');
  }
  await h.kernel.settled();
});

test('上限是现算的：调大了，排着队的线接着开跑，不用等谁做完', async () => {
  const gates: Deferred<string>[] = [deferred(), deferred()];
  let next = 0;
  let limit = 1;
  const started: string[] = [];
  const h = await harness({ extra: { maxBackground: () => limit },
    tools: [slowTool(() => gates[next++]?.promise ?? Promise.resolve('多余'), started)] });
  scriptByLine(h, Object.fromEntries(['甲', '乙'].map((title) => [`标题「${title}」`, [
    fauxAssistantMessage([fauxToolCall('slow', { what: title }, { id: `slow-${title}` })], { stopReason: 'toolUse' }),
    fauxAssistantMessage(`${title}做完了`),
  ]])));
  const first = h.kernel.spawn('main', { title: '甲', goal: '做甲', projectId: null });
  const second = h.kernel.spawn('main', { title: '乙', goal: '做乙', projectId: null });
  await until(() => started.length === 1, '第一条开跑');
  assert.equal(h.kernel.view(second.id).status, 'queued');
  assert.equal(h.kernel.backgroundLimit(), 1);
  limit = 2;
  h.kernel.reschedule();
  await until(() => started.length === 2, '调大以后第二条开跑');
  assert.equal(h.kernel.view(first.id).status, 'running');
  for (const gate of gates) {
    gate.resolve('好');
  }
  await h.kernel.settled();
});
