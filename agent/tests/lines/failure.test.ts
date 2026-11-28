import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { classifyFailure, DEFAULT_PAUSE_MS, logModelFailure, RETRY_DELAYS_MS, resetTime,
  sanitizeModelError } from '../../src/lines/index.ts';
import { captureLogs } from '../safety-helpers.ts';
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

test('Model unreachable retries 3 times with backoff; 4th attempt completes normally', async () => {
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

test('After 3 failed retries line enters failed with reason; retry resumes from DB', async () => {
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

test('Quota exhausted pauses line and auto-resumes at time specified in error', async () => {
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

test('Background line quota error notifies main chat once even if resumed hit recurs', async () => {
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

test('Auth expiry fails line immediately without retry and explains where to reconnect', async () => {
  const h = await harness();
  h.respond([failed('401 Unauthorized: invalid_grant')]);
  h.kernel.send('main', { text: '在吗' });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'failed');
  assert.ok(h.kernel.view('main').failure?.includes('重新连接'));
  assert.equal(h.clock.pending(), 0);
});

test('Model disconnect mid-tool keeps completed tool results in DB for retry', async () => {
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

test('Reset time parses resets_at, \'try again in ~N min\', ISO, or defaults to +1h', () => {
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

test('Sanitizes Bearer tokens, sk keys, and long error text before logging', () => {
  const raw = 'HTTP 429 Authorization: Bearer example-token-0000 with key sk-test00000000\n  failed';
  assert.equal(sanitizeModelError(raw), 'HTTP 429 Authorization: Bearer [redacted] with key [redacted] failed');
  const clipped = sanitizeModelError('x'.repeat(260));
  assert.equal(clipped.length, 241);
  assert.ok(clipped.endsWith('…'));
});

test('Logs model_call_failed with provider/model, status, and scrubbed errorMessage', (context) => {
  const logs = captureLogs(context);
  const now = new Date('2026-11-05T08:00:00.000Z');
  const message = {
    ...failed('429 rate limit with Bearer example-token-0000 and sk-test00000000'),
    provider: 'qwen-token-plan-individual-cn',
    model: 'qwen4-max',
  };
  logModelFailure(message, classifyFailure(message, now));
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
  assert.equal(entry['event'], 'model_call_failed');
  assert.equal(entry['category'], 'network');
  assert.equal(entry['stepKey'], 'qwen-token-plan-individual-cn/qwen4-max');
  assert.equal(entry['status'], 429);
  assert.equal(entry['errorMessage'], '429 rate limit with Bearer [redacted] and [redacted]');
});
