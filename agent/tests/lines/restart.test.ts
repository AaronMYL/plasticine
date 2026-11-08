// 第二级：重启续跑。服务启动时 running 的线接着跑（continue）；停在一组工具中间的，能安全重做的重做、其余如实写
// 「不知道做没做成」；在等他定的线接着等同一张卡；paused 的到点再跑；排着队的消息不丢。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID, type StateService } from '../../src/state/index.ts';
import { openTestState } from '../state/helpers.ts';
import { echoTool, mailTool, startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

async function restart(options: Parameters<typeof startKernel>[0]): Promise<Harness> {
  const started = await startKernel(options);
  open.push(started);
  return started;
}

function user(state: StateService, text: string): void {
  state.lineMessages.append(MAIN_LINE_ID, 'user', { role: 'user', content: text, timestamp: 1 });
}

function toolUse(state: StateService, name: string, args: Record<string, string>, id: string): void {
  const message = fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: 'toolUse' });
  state.lineMessages.append(MAIN_LINE_ID, 'assistant', message);
}

function lastResult(context: TranscriptContext): string {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const last = results[results.length - 1];
  return last?.role === 'toolResult' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
}

test('重启前在跑、库里末尾是他的话：启动后接着跑完', async () => {
  const handle = await openTestState();
  handle.state.lines.main();
  user(handle.state, '查一下');
  handle.state.lines.update(MAIN_LINE_ID, { status: 'running' });
  const h = await restart({ handle });
  h.respond([fauxAssistantMessage('接着做完了。')]);
  await until(() => h.kernel.view('main').status === 'idle', '跑完');
  assert.equal(h.kernel.view('main').lastAnswer, '接着做完了。');
});

test('重启前停在工具中间：不能重做的如实写「不知道做没做成」，能安全重做的重做，然后接着问模型', async () => {
  const handle = await openTestState();
  handle.state.lines.main();
  user(handle.state, '两件事');
  const message = fauxAssistantMessage([fauxToolCall('echo', { text: '外面的事' }, { id: 'e1' }),
    fauxToolCall('list_lines', {}, { id: 'l1' })], { stopReason: 'toolUse' });
  handle.state.lineMessages.append(MAIN_LINE_ID, 'assistant', message);
  handle.state.lines.update(MAIN_LINE_ID, { status: 'running' });
  const h = await restart({ handle, tools: [echoTool()] });
  h.respond([(context) => fauxAssistantMessage(`最后一个结果：${lastResult(context).slice(0, 10)}`)]);
  await until(() => h.kernel.view('main').status === 'idle', '跑完');
  const results = h.kernel.read('main', 50).messages.filter((row) => row.role === 'toolResult');
  assert.equal(results[0]?.tool, 'echo');
  assert.equal(results[0]?.ok, false);
  assert.ok(results[0]?.text.includes('不知道做没做成'));
  assert.equal(results[1]?.tool, 'list_lines');
  assert.equal(results[1]?.ok, true, 'list_lines 能安全重做');
  assert.ok(h.kernel.view('main').lastAnswer?.startsWith('最后一个结果：{"lines"'));
});

test('重启前在等他定：卡不撤，重启后接着等同一张卡；他同意后执行一次、接着跑完', async () => {
  const sent: string[] = [];
  const first = await startKernel({ tools: [mailTool(sent)] });
  first.respond([fauxAssistantMessage([fauxToolCall('send_mail', { to: 'Bolt', body: '周五见' }, { id: 'm1' })],
    { stopReason: 'toolUse' })]);
  first.kernel.send('main', { text: '发信' });
  await until(() => first.kernel.view('main').status === 'waiting', '在等他');
  const ask = first.handle.state.asks.open()[0];
  await first.kernel.stop();
  assert.equal(first.handle.state.asks.get(ask?.id ?? '')?.status, 'open', '关服务不撤卡');
  assert.equal(first.handle.state.lineApprovals.forCall(MAIN_LINE_ID, 'm1')?.status, 'pending');
  const h = await restart({ handle: first.handle, tools: [mailTool(sent)] });
  h.respond([(context) => fauxAssistantMessage(`结果：${lastResult(context)}`)]);
  await until(() => h.kernel.view('main').status === 'waiting', '重启后接着等');
  assert.equal(h.handle.state.asks.open().length, 1, '没有出第二张卡');
  h.desk.answer({ askId: ask?.id ?? '', optionId: 'allow', answerer: { deviceId: 'd' } });
  await until(() => h.kernel.view('main').status === 'idle', '跑完');
  assert.deepEqual(sent, ['Bolt:周五见']);
  assert.equal(h.kernel.view('main').lastAnswer, '结果：已发出');
});

test('重启前 paused：启动后到点再跑', async () => {
  const handle = await openTestState();
  handle.state.lines.main();
  user(handle.state, '在吗');
  handle.state.lines.update(MAIN_LINE_ID, { status: 'paused', pausedUntil: '2026-11-05T08:10:00.000Z',
    failure: '模型额度用完了' });
  const h = await restart({ handle });
  h.respond([fauxAssistantMessage('额度回来了。')]);
  assert.equal(h.kernel.view('main').status, 'paused');
  h.clock.advance(10 * 60_000);
  await until(() => h.kernel.view('main').status === 'idle', '到点跑完');
  assert.equal(h.kernel.view('main').lastAnswer, '额度回来了。');
});

test('重启前排着队的消息不丢：启动后发出去开一轮', async () => {
  const handle = await openTestState();
  handle.state.lines.main();
  const item = handle.state.lineQueue.add(MAIN_LINE_ID, '排着的那句', []);
  const h = await restart({ handle });
  h.respond([fauxAssistantMessage('收到排着的那句。')]);
  await until(() => h.kernel.view('main').status === 'idle' && h.kernel.view('main').lastAnswer !== null, '跑完');
  assert.equal(h.handle.state.lineQueue.get(item.id)?.status, 'sent');
  assert.equal(h.kernel.view('main').lastAnswer, '收到排着的那句。');
});

test('重启前回答已经写完、只是状态没来得及改：启动后不再问模型，直接回到空闲', async () => {
  const handle = await openTestState();
  handle.state.lines.main();
  user(handle.state, '在吗');
  toolUse(handle.state, 'echo', { text: 'x' }, 'e1');
  handle.state.lineMessages.append(MAIN_LINE_ID, 'toolResult', { role: 'toolResult', toolCallId: 'e1',
    toolName: 'echo', content: [{ type: 'text', text: '回声：x' }], isError: false, timestamp: 2 });
  handle.state.lineMessages.append(MAIN_LINE_ID, 'assistant', fauxAssistantMessage('答完了。'));
  handle.state.lines.update(MAIN_LINE_ID, { status: 'running' });
  const h = await restart({ handle, tools: [echoTool()] });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.faux.state.callCount, 0);
});
