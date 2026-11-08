// 第一级：线、跑线、接口语义。全部用 pi-ai 的假模型，不联网。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, type AssistantMessage, type TranscriptContext }
  from '@earendil-works/pi-ai';
import { LineError, NO_MODEL_REASON } from '../../src/lines/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { deferred, echoTool, slowTool, startKernel, until, type Harness } from './helpers.ts';

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

function roles(h: Harness, lineId = MAIN_LINE_ID): string[] {
  return h.handle.state.lineMessages.after(lineId, 0).map((row) => row.role);
}

function lastUserText(context: TranscriptContext): string {
  const users = context.messages.filter((message) => message.role === 'user');
  const last = users[users.length - 1];
  if (last === undefined) {
    return '';
  }
  return typeof last.content === 'string' ? last.content
    : last.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

test('线空闲时发一句话开一轮：模型停下时最后那段文字就是答案，线回到空闲，两条消息原样写进库', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage([fauxThinking('先想想'), fauxText('你好，我在。')])]);
  const sent = h.kernel.send('main', { text: '在吗' });
  assert.equal(sent.outcome, 'started');
  assert.equal(sent.message?.text, '在吗');
  await h.kernel.settled();
  const line = h.kernel.view('main');
  assert.equal(line.status, 'idle');
  assert.equal(line.lastAnswer, '你好，我在。');
  assert.deepEqual(roles(h), ['user', 'assistant']);
  const stored = h.handle.state.lineMessages.last(MAIN_LINE_ID)?.message as AssistantMessage;
  assert.equal(stored.stopReason, 'stop');
  assert.equal(stored.provider, h.faux.getModel().provider);
  const text = h.events.flatMap((event) => (event.type === 'line_text' ? [event.delta] : [])).join('');
  assert.equal(text, '你好，我在。');
  assert.ok(h.events.some((event) => event.type === 'line_thinking'));
  const statuses = h.events.flatMap((event) => (event.type === 'line_changed' ? [event.line.status] : []));
  assert.equal(statuses.at(-1), 'idle');
  assert.ok(statuses.includes('running'));
  const read = h.kernel.read('main', 50);
  assert.deepEqual(read.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(read.messages[1]?.thinking, '先想想');
});

test('工具调用：每一步带工具自己声明的大白话推给客户端，工具结果写进库，模型接着答', async () => {
  const h = await harness({ tools: [echoTool()] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('echo', { text: '签名' }, { id: 'call-1' })], { stopReason: 'toolUse' }),
    (context) => {
      const result = context.messages.find((message) => message.role === 'toolResult');
      assert.ok(result !== undefined, '第二次请求带着工具结果');
      return fauxAssistantMessage('签名有效。');
    },
  ]);
  h.kernel.send('main', { text: '验证一下签名' });
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant', 'toolResult', 'assistant']);
  const tools = h.events.flatMap((event) => (event.type === 'line_tool' ? [event] : []));
  assert.deepEqual(tools.map((event) => [event.phase, event.say, event.ok]),
    [['started', '回声：签名', null], ['ended', '回声：签名', true]]);
  assert.equal(tools[1]?.summary, '回声：签名');
  const read = h.kernel.read('main', 50);
  assert.deepEqual(read.messages[1]?.steps, [{ toolCallId: 'call-1', tool: 'echo', say: '回声：签名' }]);
  assert.equal(read.messages[2]?.say, '回声：签名');
  assert.equal(read.messages[2]?.ok, true);
  assert.equal(h.kernel.view('main').lastAnswer, '签名有效。');
});

test('工具报错原样作为工具结果交回模型，线不失败', async () => {
  const h = await harness({ tools: [echoTool()] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('echo', { wrong: 1 }, { id: 'bad' })], { stopReason: 'toolUse' }),
    (context) => {
      const result = context.messages.find((message) => message.role === 'toolResult');
      assert.equal(result?.role === 'toolResult' && result.isError, true);
      return fauxAssistantMessage('参数写错了，我改一下。');
    },
  ]);
  h.kernel.send('main', { text: '试试' });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.read('main', 50).messages[2]?.ok, false);
});

test('线在跑时发消息进排队；这一轮结束后自动按顺序发出，模型接着答', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '读签名' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('签名有效。'),
    (context) => fauxAssistantMessage(`收到：${lastUserText(context)}`),
  ]);
  h.kernel.send('main', { text: '查一下 CuaDriver.app' });
  await until(() => h.kernel.view('main').activity === '慢慢做：读签名…', '在跑那一步');
  const queued = h.kernel.send('main', { text: '再看看它有没有开机自启' });
  const second = h.kernel.send('main', { text: '顺便看版本' });
  assert.equal(queued.outcome, 'queued');
  assert.equal(h.kernel.view('main').queued, 2);
  assert.ok(h.events.some((event) => event.type === 'line_queue' && event.queue.length === 2));
  gate.resolve('Cua AI, Inc.');
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant', 'toolResult', 'assistant', 'user', 'user', 'assistant']);
  assert.equal(h.kernel.view('main').lastAnswer, '收到：顺便看版本');
  assert.equal(h.handle.state.lineQueue.get(queued.queued?.id ?? '')?.status, 'sent');
  assert.equal(h.handle.state.lineQueue.get(second.queued?.id ?? '')?.sentSeq, 6);
  assert.equal(h.kernel.view('main').queued, 0);
});

test('立即发送：把排队的那条插进正在跑的这一轮，工具结果之后模型就看到', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '读签名' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
    (context) => {
      const tail = context.messages.slice(-2).map((message) => message.role);
      assert.deepEqual(tail, ['toolResult', 'user']);
      return fauxAssistantMessage(`一起答：${lastUserText(context)}`);
    },
  ]);
  h.kernel.send('main', { text: '查一下' });
  await until(() => h.kernel.view('main').activity === '慢慢做：读签名…', '在跑那一步');
  const queued = h.kernel.send('main', { text: '它有没有开机自启' });
  h.kernel.sendNow('main', queued.queued?.id ?? '');
  gate.resolve('签名有效');
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant', 'toolResult', 'user', 'assistant']);
  assert.equal(h.kernel.view('main').lastAnswer, '一起答：它有没有开机自启');
  assert.equal(h.handle.state.lineQueue.get(queued.queued?.id ?? '')?.status, 'sent');
});

test('撤回排队的消息：不再发出；发出过的撤不回', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('查完了。'),
  ]);
  h.kernel.send('main', { text: '查一下' });
  await until(() => h.kernel.view('main').activity === '慢慢做：查…', '在跑那一步');
  const queued = h.kernel.send('main', { text: '算了不用了' });
  const withdrawn = h.kernel.withdraw('main', queued.queued?.id ?? '');
  assert.equal(withdrawn.item.status, 'withdrawn');
  assert.equal(withdrawn.line.queued, 0);
  gate.resolve('好');
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant', 'toolResult', 'assistant']);
  assert.throws(() => h.kernel.withdraw('main', queued.queued?.id ?? ''),
    (error: unknown) => error instanceof LineError && error.code === 'conflict');
});

test('撤回一条已经交给立即发送、还没发出的消息：它不会再插进这一轮', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`看到的最后一句：${lastUserText(context)}`),
  ]);
  h.kernel.send('main', { text: '查一下' });
  await until(() => h.kernel.view('main').activity === '慢慢做：查…', '在跑那一步');
  const kept = h.kernel.send('main', { text: '留着这句' });
  const dropped = h.kernel.send('main', { text: '撤掉这句' });
  h.kernel.sendNow('main', kept.queued?.id ?? '');
  h.kernel.sendNow('main', dropped.queued?.id ?? '');
  h.kernel.withdraw('main', dropped.queued?.id ?? '');
  gate.resolve('好');
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').lastAnswer, '看到的最后一句：留着这句');
  assert.equal(h.handle.state.lineQueue.get(dropped.queued?.id ?? '')?.status, 'withdrawn');
});

test('暂停：中止正在跑的这一轮；排队的消息留着不自动发', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
  ]);
  h.kernel.send('main', { text: '查一下' });
  await until(() => h.kernel.view('main').activity === '慢慢做：查…', '在跑那一步');
  const queued = h.kernel.send('main', { text: '排着的' });
  h.kernel.halt('main');
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'paused');
  assert.equal(h.kernel.view('main').pauseReason, 'user');
  assert.equal(h.handle.state.lineQueue.get(queued.queued?.id ?? '')?.status, 'queued');
  const result = h.kernel.read('main', 50).messages.find((message) => message.role === 'toolResult');
  assert.equal(result?.ok, false);
  assert.equal(h.faux.getPendingResponseCount(), 0);
});

test('线空闲时立即发送排着的那条：用它开一轮', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('好的。')]);
  const item = h.handle.state.lineQueue.add(MAIN_LINE_ID, '排着没发的', []);
  h.kernel.sendNow('main', item.id);
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant']);
  assert.equal(h.handle.state.lineQueue.get(item.id)?.status, 'sent');
});

test('还没连接模型：线进 failed，原因写清去哪连接', async () => {
  const h = await harness({ noModel: true });
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  const line = h.kernel.view('main');
  assert.equal(line.status, 'failed');
  assert.equal(line.failure, NO_MODEL_REASON);
});

test('附件：发消息带上附件 id，模型看到名字和 id，界面列出 id；没有这份附件就拒', async () => {
  const h = await harness();
  assert.throws(() => h.kernel.send('main', { text: '看看这个', attachments: ['missing'] }),
    (error: unknown) => error instanceof LineError && error.code === 'invalid');
  assert.deepEqual(roles(h), []);
});

test('读一条线分页：最新的一页，往上翻带 before', async () => {
  const h = await harness();
  for (const word of ['一', '二', '三']) {
    h.respond([fauxAssistantMessage(`答${word}`)]);
    h.kernel.send('main', { text: `问${word}` });
    await h.kernel.settled();
  }
  const page = h.kernel.read('main', 2);
  assert.deepEqual(page.messages.map((message) => message.text), ['问三', '答三']);
  assert.equal(page.hasMore, true);
  const older = h.kernel.read('main', 10, page.messages[0]?.seq ?? null);
  assert.deepEqual(older.messages.map((message) => message.text), ['问一', '答一', '问二', '答二']);
  assert.equal(older.hasMore, false);
});

test('还在想的时候叫停：库里记一条空的「停下了」，读回来还在；下一轮不把它送给模型', async () => {
  const h = await harness();
  h.respond([(_context, options) => new Promise<AssistantMessage>((resolve) => {
    options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted' })));
  })]);
  h.kernel.send('main', { text: '想想这件事' });
  await until(() => h.kernel.view('main').status === 'running' && h.faux.state.callCount === 1, '模型在想');
  h.kernel.halt('main');
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'paused');
  const read = h.kernel.read('main', 50).messages;
  assert.deepEqual(read.map((message) => [message.role, message.stopReason]),
    [['user', null], ['assistant', 'aborted']]);
  let seen: string[] = [];
  h.respond([(context) => {
    seen = context.messages.filter((message) => message.role !== 'system').map((message) => message.role);
    return fauxAssistantMessage('接着说。');
  }]);
  h.kernel.send('main', { text: '算了，直接说' });
  h.kernel.retry('main');
  await h.kernel.settled();
  assert.deepEqual(seen, ['user', 'user']);
});

test('刷新后和实时一样：回答记着想了多久，工具结果记着那一句结果', async () => {
  const h = await harness({ tools: [echoTool()] });
  h.respond([
    fauxAssistantMessage([fauxThinking('先查'), fauxToolCall('echo', { text: '签名' }, { id: 'e-1' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('好了。'),
  ]);
  h.kernel.send('main', { text: '查一下' });
  await h.kernel.settled();
  const ended = h.events.find((event) => event.type === 'line_tool' && event.phase === 'ended');
  const read = h.kernel.read('main', 50).messages;
  const thought = read.find((message) => message.role === 'assistant' && message.thinking !== null);
  assert.equal(typeof thought?.thinkingMs, 'number');
  const result = read.find((message) => message.role === 'toolResult');
  assert.ok(ended?.type === 'line_tool' && ended.summary !== null);
  assert.equal(result?.summary, ended.type === 'line_tool' ? ended.summary : undefined);
  assert.equal(read.find((message) => message.role === 'user')?.thinkingMs, null);
});

function pngAttachment(h: Harness): string {
  const data = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const { attachments } = h.handle.state;
  const row = attachments.open({ requestId: 'req_png_000001', name: '截图.png', mimeType: 'image/png',
    bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }, 'owner-1');
  attachments.storeBytes(row.id, data);
  attachments.finish(row.id, { text: null, truncated: false, error: null });
  return row.id;
}

for (const vision of [true, false]) {
  test(`图片附件：模型${vision ? '能看图就把图本身带上' : '不能看图只带附件说明'}；库里存的消息不带图`, async () => {
    const h = await harness({ vision });
    const id = pngAttachment(h);
    let images = -1;
    h.respond([(context) => {
      const user = context.messages.filter((message) => message.role === 'user').at(-1);
      images = user === undefined || typeof user.content === 'string' ? 0
        : user.content.filter((part) => part.type === 'image').length;
      return fauxAssistantMessage('看到了。');
    }]);
    h.kernel.send('main', { text: '看看这张', attachments: [id] });
    await h.kernel.settled();
    assert.equal(images, vision ? 1 : 0);
    assert.equal(JSON.stringify(h.handle.state.lineMessages.after(MAIN_LINE_ID, 0)).includes('"image"'), false);
  });
}

test('立即发送插进这一轮的那条记成「已插入」：读回来（刷新后）还是已插入，不再给立即发送；写进这一轮后是已发出', async () => {
  const gate = deferred<string>();
  const h = await harness({ tools: [slowTool(() => gate.promise)] });
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 'slow-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('一起答了。'),
  ]);
  h.kernel.send('main', { text: '查一下' });
  await until(() => h.kernel.view('main').activity === '慢慢做：查…', '在跑那一步');
  const queued = h.kernel.send('main', { text: '顺便看看开机自启' });
  const id = queued.queued?.id ?? '';
  h.kernel.sendNow('main', id);
  assert.deepEqual(h.kernel.read('main', 50).queue.map((item) => [item.id, item.status]), [[id, 'inserted']]);
  assert.equal(h.handle.state.lineQueue.get(id)?.status, 'inserted');
  assert.throws(() => h.kernel.sendNow('main', id),
    (error: unknown) => error instanceof LineError && error.code === 'conflict');
  gate.resolve('好');
  await h.kernel.settled();
  assert.equal(h.handle.state.lineQueue.get(id)?.status, 'sent');
  assert.deepEqual(h.kernel.read('main', 50).queue, []);
});
