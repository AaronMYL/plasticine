import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { deferred, echoTool, scriptByLine, slowTool, startKernel, until, type Harness } from './helpers.ts';

const opened: Harness[] = [];

async function harness(options: Parameters<typeof startKernel>[0] = {}): Promise<Harness> {
  const h = await startKernel(options);
  opened.push(h);
  return h;
}

afterEach(async () => {
  for (const h of opened.splice(0)) {
    await h.close();
  }
});

test('Paused background line keeps queue, does not auto-run until explicitly resumed', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gate.promise, started)] });
  h.respond([fauxAssistantMessage([fauxToolCall('slow', { what: '第一版' }, { id: 'slow' })],
    { stopReason: 'toolUse' })]);
  const line = h.kernel.open({ title: '交付', goal: '做第一版', projectId: null, parentLineId: null });
  await until(() => started.length === 1, '第一版开始');
  const queued = h.kernel.send(line.id, { text: '补上第二部分' });
  h.kernel.halt(line.id);
  await h.kernel.settled();
  assert.equal(h.kernel.view(line.id).status, 'paused');
  assert.equal(h.kernel.view(line.id).pauseReason, 'user');
  assert.equal(h.kernel.view(line.id).outcome, null, '暂停不是结束');
  assert.equal(h.handle.state.lineQueue.get(queued.queued?.id ?? '')?.status, 'queued');
  assert.equal(h.clock.pending(), 0, '用户暂停不能安排自动恢复');
  h.respond([fauxAssistantMessage('两部分都做完了。')]);
  h.kernel.retry(line.id);
  await h.kernel.settled();
  assert.equal(h.kernel.answer(line.id), '两部分都做完了。');
  assert.equal(h.kernel.view(line.id).outcome, 'done');
  assert.equal(h.kernel.view(line.id).queued, 0);
});

test('User pause persists across restart; external rework queues without unpausing', async () => {
  const h = await harness();
  const line = h.handle.state.lines.create({ kind: 'background', title: '暂停的事',
    projectId: null, parentLineId: null });
  h.kernel.halt(line.id);
  const sent = h.kernel.send(line.id, { text: '对方要加一个例子', origin: { kind: 'network' } });
  assert.equal(sent.outcome, 'queued');
  await h.kernel.stop();
  opened.splice(opened.indexOf(h), 1);
  const next = await harness({ handle: h.handle });
  await next.kernel.settled();
  assert.equal(next.kernel.view(line.id).status, 'paused');
  assert.equal(next.kernel.view(line.id).pauseReason, 'user');
  assert.equal(next.kernel.view(line.id).queued, 1);
  assert.equal(next.clock.pending(), 0);
});

test('Max-length output keeps text, marks incomplete, skips delivery until continued', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('写到这里，还没', { stopReason: 'length' })]);
  const line = h.kernel.open({ title: '长回答', goal: '写一份完整分析', projectId: null, parentLineId: null });
  await h.kernel.settled();
  assert.equal(h.kernel.view(line.id).status, 'paused');
  assert.equal(h.kernel.view(line.id).pauseReason, 'output_limit');
  assert.equal(h.kernel.view(line.id).outcome, 'incomplete');
  assert.equal(h.kernel.view(line.id).lastAnswer, '写到这里，还没');
  assert.equal(h.kernel.answer(line.id), null);
  assert.equal(h.clock.pending(), 0);
  h.respond([(context) => {
    assert.ok(JSON.stringify(context.messages).includes('写到这里，还没'), '接着原文写，不丢半段结果');
    return fauxAssistantMessage('写完。现在补齐剩余部分和完整结论。');
  }]);
  h.kernel.retry(line.id);
  await h.kernel.settled();
  assert.equal(h.kernel.view(line.id).outcome, 'done');
  assert.equal(h.kernel.answer(line.id), '写到这里，还没写完。现在补齐剩余部分和完整结论。');
});

test('Queued new request on delivered line does not reuse old answer as new delivery', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('第一版')]);
  const line = h.kernel.open({ title: '返工', goal: '写第一版', projectId: null, parentLineId: null });
  await h.kernel.settled();
  assert.equal(h.kernel.answer(line.id), '第一版');
  h.handle.state.lineQueue.add(line.id, '加一个例子', []);
  assert.equal(h.kernel.answer(line.id), null);
  assert.equal(h.kernel.view(line.id).outcome, null);
});

test('Manual retry obeys background concurrency cap and waits for slot without loss', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gate.promise, started)], extra: { maxBackground: 1 } });
  scriptByLine(h, {
    '标题「甲」': [fauxAssistantMessage([fauxToolCall('slow', { what: '甲' }, { id: 'a' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('甲完成')],
    '标题「乙」': [fauxAssistantMessage([fauxToolCall('slow', { what: '乙' }, { id: 'b' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('乙完成')],
  });
  h.kernel.open({ title: '甲', goal: '做甲', projectId: null, parentLineId: null });
  await until(() => started.length === 1, '甲开始');
  const second = h.handle.state.lines.create({ kind: 'background', title: '乙', projectId: null,
    parentLineId: null });
  h.handle.state.lineMessages.append(second.id, 'user', { role: 'user', content: '做乙', timestamp: 1 });
  h.handle.state.lines.update(second.id, { status: 'failed', failure: '暂时失败' });
  h.kernel.retry(second.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['甲']);
  gate.resolve('好了');
  await h.kernel.settled();
  assert.deepEqual(started, ['甲', '乙']);
  assert.equal(h.kernel.answer(second.id), '乙完成');
});

test('Disabled tool blocks in-flight model call and is omitted from next request', async () => {
  let enabled = true;
  let executions = 0;
  const original = echoTool();
  const tool = { ...original, enabled: () => enabled, create: (scope: Parameters<typeof original.create>[0]) => {
    const adapted = original.create(scope);
    return { ...adapted, execute: async (...args: Parameters<typeof adapted.execute>) => {
      executions += 1;
      return adapted.execute(...args);
    } };
  } };
  const h = await harness({ tools: [tool] });
  h.respond([
    () => {
      enabled = false;
      return fauxAssistantMessage([fauxToolCall('echo', { text: '不该执行' }, { id: 'disabled' })],
        { stopReason: 'toolUse' });
    },
    (context) => {
      const system = context.messages.find((message) => message.role === 'system');
      assert.ok(!JSON.stringify(system).includes('"name":"echo"'), '下一次请求刷新工具声明');
      return fauxAssistantMessage('这件工具已关闭。');
    },
  ]);
  h.kernel.send('main', { text: '试一下' });
  await h.kernel.settled();
  assert.equal(executions, 0);
  assert.equal(h.kernel.view('main').lastAnswer, '这件工具已关闭。');
  assert.equal(h.kernel.read('main', 20).messages.find((message) => message.role === 'toolResult')?.ok, false);
});

test('Each request restores loaded Skills; sealed reply line sees sealed prompt only', async () => {
  let methods = '已加载方法：核对原文。';
  const h = await harness({ tools: [echoTool()], extra: { skillsContext: () => methods } });
  h.respond([
    (context) => {
      assert.ok(JSON.stringify(context.messages).includes(methods));
      methods = '已加载方法：核对原文，并保留页码。';
      return fauxAssistantMessage([fauxToolCall('echo', { text: '查' }, { id: 'read' })],
        { stopReason: 'toolUse' });
    },
    (context) => {
      assert.ok(JSON.stringify(context.messages).includes(methods));
      return fauxAssistantMessage('已核对。');
    },
  ]);
  h.kernel.send('main', { text: '按方法做' });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').lastAnswer, '已核对。');
  h.respond([(context) => {
    assert.ok(!JSON.stringify(context.messages).includes(methods));
    return fauxAssistantMessage('只回答公开材料。');
  }]);
  const sealed = h.kernel.open({ title: '封闭答话', goal: '回答', projectId: null, parentLineId: null,
    sealedPrompt: '只用这段公开材料。' });
  await h.kernel.settled();
  assert.equal(h.kernel.answer(sealed.id), '只回答公开材料。');
});

test('Direct input and proxy additions keep sources; queue/send never spoof user', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('记下了。')]);
  h.kernel.send('main', { text: '我喜欢简洁的界面' });
  await h.kernel.settled();
  assert.equal(h.handle.state.lineMessages.last(MAIN_LINE_ID, 'user')?.meta?.origin?.kind, 'user');
  const line = h.handle.state.lines.create({ kind: 'background', title: '外部任务', projectId: null,
    parentLineId: null });
  h.kernel.halt(line.id);
  h.kernel.send(line.id, { text: '对方喜欢绿色', origin: { kind: 'network' } });
  h.respond([fauxAssistantMessage('完成。')]);
  h.kernel.retry(line.id);
  await h.kernel.settled();
  assert.equal(h.handle.state.lineMessages.last(line.id, 'user')?.meta?.origin?.kind, 'network');
});

test('Recovering multiple interrupted bg lines uses one slot, queues rest in order', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gate.promise, started)], extra: { maxBackground: 1 } });
  const titles = ['恢复甲', '恢复乙', '恢复丙'];
  scriptByLine(h, Object.fromEntries(titles.map((title) => [`标题「${title}」`, [
    fauxAssistantMessage([fauxToolCall('slow', { what: title }, { id: title })], { stopReason: 'toolUse' }),
    fauxAssistantMessage(`${title}完成`),
  ]])));
  const lines = titles.map((title) => {
    const line = h.handle.state.lines.create({ kind: 'background', title, parentLineId: null, projectId: null });
    h.handle.state.lineMessages.append(line.id, 'user', { role: 'user', content: title, timestamp: 0 });
    h.handle.state.lines.update(line.id, { status: 'running' });
    return line;
  });
  h.kernel.start();
  await until(() => started.length === 1, '只有第一条恢复');
  assert.equal(lines.filter((line) => h.kernel.status(line.id) === 'queued').length, 2);
  gate.resolve('做完');
  await h.kernel.settled();
  assert.equal(started.length, 3);
  assert.ok(lines.every((line) => h.kernel.answer(line.id) !== null));
});

test('Quota recovery waits for a background slot and does not bypass concurrency cap', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gate.promise, started)], extra: { maxBackground: 1 } });
  scriptByLine(h, {
    '标题「占位」': [fauxAssistantMessage([fauxToolCall('slow', { what: '占位' }, { id: 'hold' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('占位完成')],
    '标题「额度恢复」': [fauxAssistantMessage('额度恢复完成')],
  });
  const waiting = h.handle.state.lines.create({ kind: 'background', title: '额度恢复',
    parentLineId: null, projectId: null });
  h.handle.state.lineMessages.append(waiting.id, 'user', { role: 'user', content: '接着做', timestamp: 0 });
  h.handle.state.lines.update(waiting.id, { status: 'paused', pauseReason: 'quota',
    pausedUntil: new Date(h.clock.now().getTime() + 1_000).toISOString() });
  h.kernel.open({ title: '占位', goal: '占一个空位', projectId: null, parentLineId: null });
  await until(() => started.length === 1, '占位开始');
  h.kernel.start();
  h.clock.advance(1_000);
  assert.equal(h.kernel.status(waiting.id), 'queued');
  assert.equal(h.kernel.answer(waiting.id), null);
  gate.resolve('完成');
  await h.kernel.settled();
  assert.equal(h.kernel.answer(waiting.id), '额度恢复完成');
});

test('Completed synthesis child resumes parent; paused parent receives post without run', async () => {
  for (const paused of [false, true]) {
    const gate = deferred<string>();
    const started: string[] = [];
    const h = await harness({ tools: [slowTool(() => gate.promise, started)] });
    scriptByLine(h, {
      这是主对话: [fauxAssistantMessage('等材料回来后整理。'), fauxAssistantMessage('结合材料，结论是……')],
      '标题「材料」': [fauxAssistantMessage([fauxToolCall('slow', { what: '材料' }, { id: 'material' })],
        { stopReason: 'toolUse' }), fauxAssistantMessage('材料原文与来源。')],
    });
    h.kernel.send('main', { text: '拿到材料后给我结论' });
    await h.kernel.settled();
    h.kernel.spawn('main', { title: '材料', goal: '收集材料', projectId: null, resumeParent: true });
    await until(() => started.length === 1, '子线在做');
    if (paused) {
      h.kernel.halt('main');
    }
    gate.resolve('材料齐了');
    await h.kernel.settled();
    assert.equal(h.kernel.view('main').lastAnswer, paused ? '等材料回来后整理。' : '结合材料，结论是……');
    assert.equal(h.kernel.view('main').status, paused ? 'paused' : 'idle');
    assert.equal(h.kernel.read('main', 30).messages.filter((message) => message.role === 'lineReport').length, 1);
  }
});

test('Withdrawing rework queued at cap returns line idle so next request starts', async () => {
  const h = await harness({ extra: { maxBackground: 1 } });
  const release = deferred<string>();
  const began = deferred<void>();
  try {
    h.respond([fauxAssistantMessage('第一版已完成。')]);
    const first = h.kernel.open({ title: '第一件', goal: '先写第一版', projectId: null, parentLineId: null });
    await h.kernel.settled();
    h.respond([async () => {
      began.resolve();
      return fauxAssistantMessage(await release.promise);
    }]);
    h.kernel.open({ title: '占位', goal: '等材料', projectId: null, parentLineId: null });
    await began.promise;
    const sent = h.kernel.send(first.id, { text: '再改一个地方' });
    assert.equal(h.kernel.view(first.id).status, 'queued');
    h.kernel.withdraw(first.id, sent.queued?.id ?? '');
    release.resolve('占位的事完成。');
    await h.kernel.settled();
    assert.equal(h.kernel.view(first.id).queued, 0);
    assert.equal(h.kernel.view(first.id).status, 'idle');
    h.respond([fauxAssistantMessage('新要求已完成。')]);
    assert.equal(h.kernel.send(first.id, { text: '现在按新要求改' }).outcome, 'started');
    await h.kernel.settled();
    assert.equal(h.kernel.answer(first.id), '新要求已完成。');
  } finally {
    release.resolve('收尾');
  }
});
