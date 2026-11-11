// 第二级：硬线。硬线工具执行前拦下 → 要你定卡（依据 hard_line）→ 线进 waiting；同意只放行这一次（绑定工具名 + 参数
// 摘要），不同意把「他没同意」作为工具结果交回模型。问他（ask_user）的卡也在这里测：答案就是工具结果。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { Ask } from '../../shared/state.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { mailTool, startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(sent: string[]): Promise<Harness> {
  const started = await startKernel({ tools: [mailTool(sent)] });
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

function openAsk(h: Harness): Ask {
  const ask = h.handle.state.asks.open()[0];
  assert.ok(ask !== undefined, '有一张开着的卡');
  return ask;
}

function allAsks(h: Harness): Ask[] {
  return h.handle.state.asks.between('0000', '9999');
}

function lastResult(context: TranscriptContext): string {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const last = results[results.length - 1];
  return last?.role === 'toolResult' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
}

const MAIL = { to: 'Bolt', body: '周五见' };

test('硬线工具先出要你定卡、线进 waiting；他同意后只执行这一次，线接着跑完', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-1' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`结果：${lastResult(context)}`),
  ]);
  h.kernel.send('main', { text: '把回复发给 Bolt' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  const ask = openAsk(h);
  assert.equal(ask.purpose, 'line_approval');
  assert.equal(ask.basis, 'hard_line');
  assert.equal(ask.kind, 'approve');
  assert.equal(ask.question, '要把这封回复发给 Bolt吗？');
  assert.deepEqual(ask.options.map((option) => [option.id, option.label, option.recommended]),
    [['allow', '发出', true], ['revise', '改一下', false], ['deny', '先不', false]]);
  assert.ok(ask.detail?.startsWith('发出后对方会收到，撤不回。'));
  assert.deepEqual(sent, [], '没同意之前没执行');
  h.desk.answer({ askId: ask.id, optionId: 'allow', answerer: { deviceId: 'device-1' } });
  await h.kernel.settled();
  assert.deepEqual(sent, ['Bolt:周五见']);
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.view('main').lastAnswer, '结果：已发出');
  assert.equal(h.handle.state.lineApprovals.forCall(MAIN_LINE_ID, 'mail-1')?.status, 'used');
});

test('他没同意：工具不执行，「他没同意」和他说的话作为工具结果交回模型', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-1' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`结果：${lastResult(context)}`),
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-2' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`结果：${lastResult(context)}`),
  ]);
  h.kernel.send('main', { text: '发吧' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  h.desk.answer({ askId: openAsk(h).id, optionId: 'revise', text: '语气客气一点', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.deepEqual(sent, []);
  const answer = h.kernel.view('main').lastAnswer ?? '';
  assert.ok(answer.includes('他没同意'), answer);
  assert.ok(answer.includes('想改一下：语气客气一点'), answer);
  const results = h.kernel.read('main', 50).messages.filter((message) => message.role === 'toolResult');
  assert.equal(results[0]?.ok, false);
  h.kernel.send('main', { text: '再试一次' });
  await until(() => h.kernel.view('main').status === 'waiting', '又在等他');
  h.desk.answer({ askId: openAsk(h).id, optionId: 'deny', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.deepEqual(sent, []);
  assert.ok((h.kernel.view('main').lastAnswer ?? '').includes('他没同意'));
});

test('一次批准只能用一次：同样的参数再调一次要重新问；改了参数也要重新问', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-2' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('send_mail', { ...MAIL, body: '改成周六' }, { id: 'mail-3' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('都问过了。'),
  ]);
  h.kernel.send('main', { text: '发三次' });
  for (const id of ['mail-1', 'mail-2', 'mail-3']) {
    await until(() => h.kernel.view('main').status === 'waiting'
      && h.handle.state.lineApprovals.forCall(MAIN_LINE_ID, id)?.status === 'pending', `等 ${id}`);
    h.desk.answer({ askId: openAsk(h).id, optionId: 'allow', answerer: { deviceId: 'd' } });
  }
  await h.kernel.settled();
  assert.deepEqual(sent, ['Bolt:周五见', 'Bolt:周五见', 'Bolt:改成周六']);
  assert.equal(allAsks(h).filter((ask) => ask.purpose === 'line_approval').length, 3, '每次都出了一张卡');
});

test('暂停正在等的线：卡撤回、批准作废，工具没执行，线保持用户暂停', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'mail-1' })], { stopReason: 'toolUse' }),
  ]);
  h.kernel.send('main', { text: '发吧' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  const ask = openAsk(h);
  h.kernel.halt('main');
  await h.kernel.settled();
  assert.deepEqual(sent, []);
  assert.equal(h.kernel.view('main').status, 'paused');
  assert.equal(h.kernel.view('main').pauseReason, 'user');
  assert.equal(h.handle.state.asks.get(ask.id)?.status, 'withdrawn');
  assert.equal(h.handle.state.lineApprovals.forCall(MAIN_LINE_ID, 'mail-1')?.status, 'withdrawn');
});

test('问他（ask_user）：出一张卡、线进 waiting，他选的就是工具结果；依据和卡的样子对不上就不出', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'decide', question: '周五还是周六？', basis: 'options',
      options: [{ id: 'fri', label: '周五' }] }, { id: 'ask-bad' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'decide', question: '周五还是周六？', basis: 'options',
      options: [{ id: 'fri', label: '周五', recommended: true }, { id: 'sat', label: '周六' }] }, { id: 'ask-1' })],
    { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`结果：${lastResult(context)}`),
  ]);
  h.kernel.send('main', { text: '约个时间' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  const ask = openAsk(h);
  assert.equal(ask.purpose, 'line_question');
  assert.equal(ask.basis, 'options');
  assert.equal(ask.options[0]?.id, 'fri', '推荐项在第一个');
  h.desk.answer({ askId: ask.id, optionId: 'sat', text: '下午', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').lastAnswer, '结果：他选了：周六（他补充：下午）');
  const results = h.kernel.read('main', 50).messages.filter((message) => message.role === 'toolResult');
  assert.equal(results[0]?.ok, false, '依据「有几种可能」只给一个选项：卡没出');
  assert.equal(allAsks(h).length, 1);
});

test('暂缓普通问题会释放主线，排队的新消息继续处理，但不会伪造答案', async () => {
  const h = await harness([]);
  h.respond([
    fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'confirm', question: '现在继续处理吗？',
      basis: 'inferred', options: [{ id: 'yes', label: '继续处理', recommended: true },
        { id: 'no', label: '暂不处理' }] }, { id: 'deferred-question' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('旧问题暂缓。'),
    fauxAssistantMessage('收到新消息。'),
  ]);
  h.kernel.send('main', { text: '准备处理' });
  await until(() => h.kernel.view('main').status === 'waiting', '等待普通问题');
  const ask = openAsk(h);
  h.kernel.send('main', { text: '任务已经做完，不用再做。' });
  h.desk.defer(ask.id);
  await until(() => h.kernel.view('main').status === 'idle', '暂缓后主线恢复空闲');
  assert.equal(h.kernel.read('main', 50).queue.length, 0);
  assert.ok(h.kernel.read('main', 50).messages.some(m => m.role === 'user' && m.text.includes('任务已经做完')));
  const retained = h.handle.state.asks.get(ask.id);
  assert.equal(retained?.status, 'open');
  assert.notEqual(retained?.deferredAt, null);
  assert.equal(retained?.answer, null);
  assert.equal(retained?.answeredByDeviceId, null);
});

test('暂缓硬线批准不会放行外发，也不会伪造拒绝或同意', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.respond([
    fauxAssistantMessage([fauxToolCall('send_mail', MAIL, { id: 'defer-approval' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('已停止。'),
  ]);
  h.kernel.send('main', { text: '准备发送' });
  await until(() => h.kernel.view('main').status === 'waiting', '等待批准');
  const ask = openAsk(h);
  h.desk.defer(ask.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.kernel.view('main').status, 'waiting');
  assert.deepEqual(sent, []);
  assert.equal(h.handle.state.asks.get(ask.id)?.answer, null);
  h.desk.answer({ askId: ask.id, optionId: 'deny', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.deepEqual(sent, []);
});

test('暂缓的问题稍后作答仍送回原线，保留实际答案来源', async () => {
  const h = await harness([]);
  h.respond([
    fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'confirm', question: '选周五吗？', basis: 'inferred',
      options: [{ id: 'yes', label: '周五', recommended: true }, { id: 'no', label: '暂不安排' }] },
    { id: 'answer-later' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('先处理别的。'), fauxAssistantMessage('收到周五的答案。'),
  ]);
  h.kernel.send('main', { text: '安排时间' });
  await until(() => h.kernel.view('main').status === 'waiting', '已提问');
  const ask = openAsk(h);
  h.desk.defer(ask.id);
  await until(() => h.kernel.view('main').status === 'idle', '已释放等待');
  h.desk.answer({ askId: ask.id, optionId: 'yes', text: '下午三点', answerer: { deviceId: 'd' } });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').lastAnswer, '收到周五的答案。');
  assert.ok(h.kernel.read('main', 50).messages.some(m => m.origin?.ref === `ask:${ask.id}`
    && m.origin.userText === '下午三点'));
});
