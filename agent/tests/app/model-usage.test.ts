import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { KernelModels, kernelText } from '../../src/kernel/index.ts';
import { usageReport, usageWindow } from '../../src/app/model-usage.ts';
import type { UsageRow } from '../../src/state/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { fakeProviders } from '../kernel/helpers.ts';
import { MODEL_USAGE_PATH, type ModelUsageReport } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const opened: TestState[] = [];
const apps: TestApp[] = [];

afterEach(async () => {
  for (const handle of opened.splice(0)) {
    await handle.cleanup();
  }
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

async function fresh(): Promise<TestState> {
  const handle = await openTestState();
  opened.push(handle);
  return handle;
}

const names = { model: (_provider: string, model: string) => model.toUpperCase(), provider: (id: string) => `家${id}` };

function row(at: string, patch: Partial<UsageRow> = {}): UsageRow {
  return { at, purpose: 'main', lineId: 'main', provider: 'openai', model: 'gpt-6-astra', input: 100, cacheRead: 900,
    cacheWrite: 0, output: 10, cost: 0.5, ...patch };
}

test('usage daily buckets use owner timezone; 7d/30d bars and today hourly buckets align', () => {
  const now = new Date('2026-11-18T08:00:00Z');
  const week = usageWindow('week', 'Asia/Shanghai', now);
  assert.equal(week.buckets.length, 7);
  assert.equal(week.buckets.at(-1)?.label, '11-18');
  assert.equal(week.since, '2026-11-11T16:00:00.000Z');
  assert.equal(usageWindow('month', 'Asia/Shanghai', now).buckets.length, 30);
  const report = usageReport([row('2026-11-17T23:00:00Z'), row('2026-11-17T15:59:00Z'), row('2026-11-10T00:00:00Z')],
    'week', 'Asia/Shanghai', now, names);
  assert.equal(report.buckets.at(-1)?.amount.requests, 1, '11-18 上海早上 7 点');
  assert.equal(report.buckets.at(-2)?.amount.requests, 1, '11-17 晚上 11 点 59');
  assert.equal(report.total.requests, 2, '一周以前的不算');
  const today = usageReport([row('2026-11-17T23:30:00Z'), row('2026-11-18T01:10:00Z'), row('2026-11-17T15:00:00Z')],
    'today', 'Asia/Shanghai', now, names);
  assert.equal(today.buckets.length, 24);
  assert.equal(today.buckets[7]?.amount.requests, 1);
  assert.equal(today.buckets[9]?.amount.requests, 1);
  assert.equal(today.total.requests, 2, '昨天的不进今天');
});

test('usage totals include cache read/write, rank by model/purpose, count lines, flag unpriced models', () => {
  const now = new Date('2026-11-18T08:00:00Z');
  const report = usageReport([
    row('2026-11-18T01:00:00Z', { purpose: 'agent', lineId: 'b1' }),
    row('2026-11-18T02:00:00Z', { purpose: 'agent', lineId: 'b1' }),
    row('2026-11-18T03:00:00Z', { purpose: 'agent', lineId: 'b2' }),
    row('2026-11-18T03:00:00Z', { purpose: 'note_predict', lineId: null, input: 50, cacheRead: 0, output: 5,
      cost: 0.01 }),
    row('2026-11-18T04:00:00Z', { purpose: 'side', lineId: 's1', provider: 'custom-1', model: 'monk-opus',
      cost: 0 }),
  ], 'week', 'Asia/Shanghai', now, names);
  assert.deepEqual(report.total, { requests: 5, input: 4_050, cacheRead: 3_600, output: 45, cost: 1.51,
    priced: true });
  assert.deepEqual(report.byPurpose.map((group) => [group.name, group.lines, group.amount.requests]),
    [['后台线', 2, 3], ['队友', 1, 1], ['续写', undefined, 1]]);
  assert.deepEqual(report.byModel.map((group) => [group.name, group.provider, group.amount.priced]),
    [['GPT-6-ASTRA', '家openai', true], ['MONK-OPUS', '家custom-1', false]]);
});

test('side-channel calls log only when purpose set; merged with line usage; skips zero legacy', async () => {
  const { state } = await fresh();
  const fakes = fakeProviders();
  const kernel = new KernelModels({ state, providers: fakes.providers });
  await kernel.setApiKey('fake-key', 'key-value-for-tests');
  const usage = { input: 120, output: 30, cacheRead: 400, cacheWrite: 0, totalTokens: 550,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.05, cacheWrite: 0, total: 0.35 } };
  fakes.keyOnly.appendResponses([{ ...fauxAssistantMessage('续上了'), usage },
    { ...fauxAssistantMessage('线上的'), usage }]);
  const answer = await kernelText(kernel).ask({ purpose: 'note_predict', system: '续写',
    messages: [{ role: 'user', content: '今天' }] }, AbortSignal.timeout(5_000));
  assert.equal(answer.text, '续上了');
  const choice = kernel.current();
  assert.ok(choice !== undefined);
  await kernel.complete(choice.model, { messages: [{ role: 'user', content: '不带用途', timestamp: 1 }] });
  const main = state.lines.main();
  state.lineMessages.append(main.id, 'assistant', { ...fauxAssistantMessage('主线的回答'), usage });
  state.lineMessages.append(main.id, 'assistant', fauxAssistantMessage('迁移来的旧消息'));
  const rows = state.modelCalls.usageSince('2000-01-01T00:00:00.000Z');
  assert.deepEqual(rows.map((item) => item.purpose).sort(), ['main', 'note_predict'], '不带用途的那次不记');
  const side = rows.find((item) => item.purpose === 'note_predict');
  assert.equal(side?.provider, 'fake-key');
  assert.ok((side?.input ?? 0) > 0, '假提供商自己算的用量记进来了');
  assert.deepEqual(rows.filter((item) => item.purpose === 'main').map((item) => [item.lineId, item.input,
    item.cacheRead, item.output, item.cost]), [[main.id, 120, 400, 30, 0.35]]);
});

test('usage API requires auth, respects range/timezone with fallback, uses configured provider names', async () => {
  const t = await startTestApp();
  apps.push(t);
  assert.equal((await call(t, 'GET', MODEL_USAGE_PATH)).status, 401);
  const cookie = await pair(t);
  const main = t.state.lines.main();
  t.state.lineMessages.append(main.id, 'assistant', { ...fauxAssistantMessage('回答'), usage: { input: 10,
    output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      total: 0.02 } } });
  const report = json(await call(t, 'GET', `${MODEL_USAGE_PATH}?range=today&tz=Europe/Paris`, { cookie })) as
    unknown as ModelUsageReport;
  assert.equal(report.range, 'today');
  assert.equal(report.timeZone, 'Europe/Paris');
  assert.equal(report.total.requests, 1);
  assert.deepEqual(report.byPurpose.map((group) => [group.name, group.lines]), [['主线', 1]]);
  const fallback = json(await call(t, 'GET', `${MODEL_USAGE_PATH}?tz=Mars/Base`, { cookie })) as
    unknown as ModelUsageReport;
  assert.equal(fallback.range, 'week');
  assert.notEqual(fallback.timeZone, 'Mars/Base');
  assert.equal((await call(t, 'GET', `${MODEL_USAGE_PATH}?range=year`, { cookie })).status, 400);
});
