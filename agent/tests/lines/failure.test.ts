// 第二级：失败。模型通道 / 网络的错重试 3 次、间隔递增，还不行线进 failed（可重试）；额度用完线进 paused，到点
// 自动接着跑、只通知一次；登录失效直接 failed。钟是手拨的，不真等。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { classifyFailure, DEFAULT_PAUSE_MS, RETRY_DELAYS_MS, resetTime } from '../../src/lines/index.ts';
import { scriptByLine, startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(): Promise<Harness> {
  const started = await startKernel();
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const failed = (message: string) => fauxAssistantMessage('', { stopReason: 'error', errorMessage: message });
const QUOTA = 'You have hit your ChatGPT usage limit (pro plan). Try again in ~30 min.';

function failures(h: Harness): string[] {
  return h.events.flatMap((event) => (event.type === 'line_changed' && event.line.failure !== null
    ? [event.line.failure] : []));
}

async function waitTimer(h: Harness): Promise<void> {
  await until(() => h.clock.pending() > 0, '排上了定时');
}

test('连不上模型：重试 3 次、间隔递增，第 4 次成功就照常答完', async () => {
  const h = await harness();
  h.respond([failed('fetch failed'), failed('socket hang up'), failed('503 service unavailable'),
    fauxAssistantMessage('终于连上了。')]);
  h.kernel.send('main', { text: '在吗' });
  for (const delay of RETRY_DELAYS_MS) {
    await waitTimer(h);
    assert.equal(h.kernel.view('main').status, 'running');
    h.clock.advance(delay);
  }
  await h.kernel.settled();
  const line = h.kernel.view('main');
  assert.equal(line.status, 'idle');
  assert.equal(line.failure, null);
  assert.equal(line.lastAnswer, '终于连上了。');
  assert.deepEqual([...new Set(failures(h))],
    ['连不上模型，第 1 次重试…', '连不上模型，第 2 次重试…', '连不上模型，第 3 次重试…']);
  assert.ok(RETRY_DELAYS_MS.every((delay, index) => index === 0 || delay > (RETRY_DELAYS_MS[index - 1] ?? 0)));
});

test('重试 3 次还不行：线进 failed，原因带上；点重试从库里接着跑', async () => {
  const h = await harness();
  h.respond([failed('fetch failed'), failed('fetch failed'), failed('fetch failed'), failed('fetch failed')]);
  h.kernel.send('main', { text: '在吗' });
  for (const delay of RETRY_DELAYS_MS) {
    await waitTimer(h);
    h.clock.advance(delay);
  }
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'failed');
  assert.equal(h.kernel.view('main').failure, '连不上模型，已重试 3 次');
  h.respond([fauxAssistantMessage('这次好了。')]);
  h.kernel.retry('main');
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.view('main').lastAnswer, '这次好了。');
  const roles = h.handle.state.lineMessages.after('line-main', 0).map((row) => row.role);
  assert.deepEqual(roles, ['user', 'assistant'], '失败的空回答不进库');
});

test('额度用完：线进 paused，到错误里给的时间自动接着跑', async () => {
  const h = await harness();
  h.respond([failed(QUOTA), fauxAssistantMessage('额度回来了。')]);
  const start = h.clock.now().getTime();
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  const paused = h.kernel.view('main');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedUntil, new Date(start + 30 * 60_000).toISOString());
  assert.equal(paused.failure, '模型额度用完了');
  h.clock.advance(29 * 60_000);
  assert.equal(h.kernel.view('main').status, 'paused');
  h.clock.advance(60_000);
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.view('main').lastAnswer, '额度回来了。');
  assert.equal(h.handle.state.lines.main().pauseNoticedAt, null, '做成一轮后清掉，下次额度用完再通知');
});

test('后台线额度用完：只通知一次——到点接着跑又撞上额度，不再往主对话贴第二条', async () => {
  const h = await harness();
  scriptByLine(h, { '标题「查额度」': [failed(QUOTA), failed(QUOTA), fauxAssistantMessage('查完了。')] });
  const child = h.kernel.spawn('main', { title: '查额度', goal: '查', projectId: null });
  await h.kernel.settled();
  assert.equal(h.kernel.view(child.id).status, 'paused');
  h.clock.advance(30 * 60_000);
  await until(() => h.kernel.view(child.id).status !== 'running', '第二次跑完');
  await h.kernel.settled();
  assert.equal(h.kernel.view(child.id).status, 'paused');
  h.clock.advance(30 * 60_000);
  await h.kernel.settled();
  const reports = h.kernel.read('main', 50).messages.filter((message) => message.role === 'lineReport');
  assert.deepEqual(reports.map((message) => message.stopReason), ['paused', 'done']);
  assert.ok(reports[0]?.text.startsWith('模型额度用完了，'));
  assert.equal(reports[1]?.text, '查完了。');
});

test('登录失效：不重试，线直接 failed，原因说去哪重新连接', async () => {
  const h = await harness();
  h.respond([failed('401 Unauthorized: invalid_grant')]);
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'failed');
  assert.ok(h.kernel.view('main').failure?.includes('重新连接'));
  assert.equal(h.clock.pending(), 0);
});

test('工具中途模型断了：已经做完的工具结果在库里，重试从工具结果后面接着问模型', async () => {
  const h = await harness();
  h.respond([
    fauxAssistantMessage([fauxToolCall('list_lines', {}, { id: 'l1' })], { stopReason: 'toolUse' }),
    failed('fetch failed'),
    fauxAssistantMessage('看完了。'),
  ]);
  h.kernel.send('main', { text: '看看线' });
  await waitTimer(h);
  h.clock.advance(RETRY_DELAYS_MS[0] ?? 0);
  await h.kernel.settled();
  const roles = h.handle.state.lineMessages.after('line-main', 0).map((row) => row.role);
  assert.deepEqual(roles, ['user', 'assistant', 'toolResult', 'assistant']);
  assert.equal(h.kernel.view('main').lastAnswer, '看完了。');
});

test('错误里的重置时间：resets_at、「try again in ~N min」、ISO 时间；没写就过一小时', () => {
  const now = new Date('2026-11-05T08:00:00.000Z');
  assert.equal(resetTime('{"resets_at": 1762333200}', now)?.toISOString(), '2025-11-05T09:00:00.000Z');
  assert.equal(resetTime('Try again in ~45 min.', now)?.toISOString(), '2026-11-05T08:45:00.000Z');
  assert.equal(resetTime('retry after 2 hours', now)?.toISOString(), '2026-11-05T10:00:00.000Z');
  assert.equal(resetTime('quota resets at 2026-11-05T13:00:00Z', now)?.toISOString(), '2026-11-05T13:00:00.000Z');
  assert.equal(resetTime('quota exceeded', now), null);
  const verdict = classifyFailure(failed('insufficient_quota'), now);
  assert.equal(verdict.kind, 'quota');
  assert.equal(verdict.kind === 'quota' ? verdict.until.getTime() - now.getTime() : 0, DEFAULT_PAUSE_MS);
  assert.equal(classifyFailure(failed('prompt is too long: 300000 tokens > 200000 maximum'), now).kind, 'overflow');
  assert.equal(classifyFailure(failed('fetch failed'), now).kind, 'retry');
  assert.equal(classifyFailure(failed('400 invalid request body'), now).kind, 'fatal');
});
