import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { HardLineGate } from '../../src/lines/hard-line.ts';
import { AnswerWaits } from '../../src/lines/waits.ts';
import { argsDigest } from '../../src/system/index.ts';
import { mailTool, startKernel, until, type Harness } from './helpers.ts';

const opened: Harness[] = [];
afterEach(async () => { for (const h of opened.splice(0)) { await h.close(); } });
const input = { actor: MAIN_LINE_ID, channel: 'fixture.mail', account: 'fixture-account',
  recipientMode: 'list' as const,
  recipients: ['Fixture'], category: 'reply', fixedTexts: null, scope: { kind: 'always' as const }, expiresAt: null };

async function harness(sent: string[]) {
  const tool = { ...mailTool(sent), outbound: (args: Record<string, unknown>) => ({
    channel: 'fixture.mail', account: 'fixture-account', recipients: [String(args.to)],
    category: 'reply', content: String(args.body),
  }) };
  const h = await startKernel({ tools: [tool] });
  opened.push(h);
  return h;
}

test('匹配的对外授权跳过硬线卡，每次真实工具执行都有日志', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  h.handle.state.outboundGrants.create(input, { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
  h.respond([fauxAssistantMessage([fauxToolCall('send_mail', { to: 'Fixture', body: '你好' }, { id: 'send-one' })],
    { stopReason: 'toolUse' }), fauxAssistantMessage('完成')]);
  h.kernel.send('main', { text: '发送' });
  await h.kernel.settled();
  assert.deepEqual(sent, ['Fixture:你好']);
  assert.equal(h.handle.state.asks.open().length, 0);
  const log = h.handle.state.outboundLog.list()[0]!;
  assert.equal(log.status, 'completed');
  assert.equal(log.content, '你好');
});

test('名单外出范围卡，仅这一次不扩大原长期授权', async () => {
  const sent: string[] = [];
  const h = await harness(sent);
  const grant = h.handle.state.outboundGrants.create(input,
    { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
  h.respond([fauxAssistantMessage([fauxToolCall('send_mail', { to: 'Outside', body: '你好' }, { id: 'send-two' })],
    { stopReason: 'toolUse' }), fauxAssistantMessage('完成')]);
  h.kernel.send('main', { text: '发送' });
  await until(() => h.kernel.view('main').status === 'waiting', '等范围确认');
  const ask = h.handle.state.asks.open()[0]!;
  assert.deepEqual(ask.options.map((option) => option.id), ['extend', 'once', 'deny']);
  assert.ok(ask.context?.outbound);
  h.desk.answer({ askId: ask.id, optionId: 'once', answerer: { deviceId: 'fixture-device' } });
  await h.kernel.settled();
  assert.deepEqual(sent, ['Outside:你好']);
  assert.deepEqual(h.handle.state.outboundGrants.get(grant.id)?.recipients, ['Fixture']);
  assert.equal(h.handle.state.outboundLog.list().length, 1);
});

test('同一次调用已有拒绝或参数冲突，后来的长期授权不能盖过原决定', async () => {
  const h = await harness([]);
  const state = h.handle.state;
  const args = { to: 'Fixture', body: '你好' };
  const ask = state.asks.create({ kind: 'approve', purpose: 'line_approval', channel: 'popup',
    question: '测试批准', options: [] });
  const approval = state.lineApprovals.create({ lineId: MAIN_LINE_ID, toolCallId: 'denied-call',
    toolName: 'send_mail', argsDigest: argsDigest(args), hardLine: 'outward', askId: ask.id });
  state.lineApprovals.setStatus(approval.id, 'declined');
  state.outboundGrants.create(input, { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
  const gate = new HardLineGate({ state, desk: h.desk, waits: new AnswerWaits(), now: h.clock.now,
    waiting: () => undefined, shuttingDown: () => false });
  const tool = { ...mailTool([]), outbound: () => ({ channel: input.channel, account: input.account,
    recipients: ['Fixture'], category: 'reply', content: '你好' }) };
  const result = await gate.check({ lineId: MAIN_LINE_ID, kind: 'main', projectId: null }, tool,
    fauxToolCall('send_mail', args, { id: 'denied-call' }), args, undefined);
  assert.equal(result?.block, true);
  assert.equal(state.outboundLog.list().length, 0);
});

test('工具结果缺失时即使没有错误标志，也只能记结果待核实', async () => {
  const h = await harness([]);
  const state = h.handle.state;
  const grant = state.outboundGrants.create(input,
    { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
  const log = state.outboundGrants.claim(grant, { actor: MAIN_LINE_ID, lineId: MAIN_LINE_ID,
    toolCallId: 'missing-result', toolName: 'send_mail', argsDigest: 'a'.repeat(64) }, {
    channel: input.channel, account: input.account, recipients: ['Fixture'], category: 'reply', content: '你好',
  })!;
  const gate = new HardLineGate({ state, desk: h.desk, waits: new AnswerWaits(), now: h.clock.now,
    waiting: () => undefined, shuttingDown: () => false });
  gate.settled(MAIN_LINE_ID, 'missing-result', mailTool([]), undefined, false);
  assert.equal(state.outboundLog.get(log.id)?.status, 'unknown');
});
