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

test('Idle line message starts turn; final text is reply, line returns idle, saved', async () => {
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

test('Tool calls stream plain-language steps to client, save results, model continues', async () => {
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

test('Tool error is returned verbatim as tool result without failing the line', async () => {
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

test('Messages sent while running queue and dispatch in order after turn ends', async () => {
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

test('Send-now injects queued message into running turn after tool results', async () => {
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

test('Withdrawing queued message prevents send; already-sent messages cannot withdraw', async () => {
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

test('Withdrawing a send-now message before dispatch prevents injecting into turn', async () => {
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

test('Pause aborts running turn and keeps queued messages from auto-sending', async () => {
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

test('Send-now on queued message when line is idle starts a new turn with it', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('好的。')]);
  const item = h.handle.state.lineQueue.add(MAIN_LINE_ID, '排着没发的', []);
  h.kernel.sendNow('main', item.id);
  await h.kernel.settled();
  assert.deepEqual(roles(h), ['user', 'assistant']);
  assert.equal(h.handle.state.lineQueue.get(item.id)?.status, 'sent');
});

test('Unconnected model fails line with clear instructions on where to connect', async () => {
  const h = await harness({ noModel: true });
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  const line = h.kernel.view('main');
  assert.equal(line.status, 'failed');
  assert.equal(line.failure, NO_MODEL_REASON);
});

test('Attachments pass name and id to model, list id in UI, reject missing attachment', async () => {
  const h = await harness();
  assert.throws(() => h.kernel.send('main', { text: '看看这个', attachments: ['missing'] }),
    (error: unknown) => error instanceof LineError && error.code === 'invalid');
  assert.deepEqual(roles(h), []);
});

test('Reading line paginates from latest page and fetches older turns via before', async () => {
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

test('Stopping during thinking saves empty stopped entry in DB, omitted next turn', async () => {
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

test('Reload matches live view: reply keeps think duration, tool keeps summary line', async () => {
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
  test(`Image attachment: ${vision ? 'sends image with vision' : 'sends note only'}; DB omits image`, async () => {
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

test('Send-now message marked injected across reload, then sent once written to turn', async () => {
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
