// /v2/lines 的接口和 /v2/events 上的线事件：真的服务、假模型（pi-ai faux），不联网。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import { LINES_PATH, ListLinesResponseSchema, LineDetailsResponseSchema, lineMessagesPath, linePath, lineQueuePath }
  from '../../shared/api/index.ts';
import type { ModelSource } from '../../src/lines/index.ts';
import { deferred, echoTool, slowTool } from '../lines/helpers.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

function fauxSource() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: models.streamSimple.bind(models),
    complete: (model, context) => models.completeSimple(model, context),
  };
  return { faux, source };
}

async function lineApp(tools = [echoTool()]) {
  const { faux, source } = fauxSource();
  const t = await startTestApp([], { lines: { models: source, tools: () => tools } });
  apps.push(t);
  const cookie = await pair(t);
  return { t, cookie, faux };
}

let counter = 0;
function requestId(): string {
  counter += 1;
  return `line-request-${String(counter).padStart(4, '0')}`;
}

async function settled(t: TestApp): Promise<void> {
  await t.app.deps.lines?.settled();
}

test('没登录读线 401', async () => {
  const { t } = await lineApp();
  assert.equal((await call(t, 'GET', LINES_PATH)).status, 401);
});

test('工作详情经真实接口返回完整正文和核验来源，未登录、缺失和错误游标各有明确结果', async () => {
  const { t, cookie, faux } = await lineApp();
  const path = `${linePath('main')}/details`;
  assert.equal((await call(t, 'GET', path)).status, 401);
  faux.appendResponses([fauxAssistantMessage('完整成果。\n\n' + '长段落。'.repeat(100))]);
  await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: requestId(), text: '请查一下来源' } });
  await settled(t);
  const reply = await call(t, 'GET', path, { cookie });
  assert.equal(reply.status, 200);
  const details = json(reply);
  assert.ok(Value.Check(LineDetailsResponseSchema, details));
  assert.equal(details.request?.source?.text, '请查一下来源');
  assert.ok((details.results[0]?.text.length ?? 0) > 280, '返回正文不被卡片预览截断');
  assert.equal((await call(t, 'GET', `${path}?before=0`, { cookie })).status, 400);
  assert.equal((await call(t, 'GET', '/v2/lines/missing/details', { cookie })).status, 404);
});

test('列线有主对话；发消息开一轮，SSE 上依次推线状态、文字增量、工具步骤、消息', async () => {
  const { t, cookie, faux } = await lineApp();
  const events = await openEvents(t, cookie);
  faux.appendResponses([
    fauxAssistantMessage([fauxToolCall('echo', { text: '签名' }, { id: 'c1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('签名有效。')]),
  ]);
  const list = json(await call(t, 'GET', LINES_PATH, { cookie }));
  assert.deepEqual((list['lines'] as { kind: string }[]).map((line) => line.kind), ['main']);
  const sent = await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: requestId(), text: '查一下 https://example.test/a?utm_source=x' } });
  assert.equal(sent.status, 200);
  assert.equal(json(sent)['outcome'], 'started');
  assert.equal((json(sent)['message'] as { text: string }).text, '查一下 https://example.test/a?utm_source=x',
    '他自己说的话原样回给他');
  const started = await events.next('line_tool');
  assert.equal(started.event.type === 'line_tool' && started.event.say, '回声：签名');
  const text = await events.next('line_text');
  assert.equal(text.event.type === 'line_text' && text.event.lineId, 'line-main');
  await settled(t);
  const read = json(await call(t, 'GET', `${linePath('main')}?limit=10`, { cookie }));
  const messages = read['messages'] as { role: string; text: string }[];
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'toolResult', 'assistant']);
  assert.equal(messages.at(-1)?.text, '签名有效。');
  assert.equal((read['line'] as { status: string }).status, 'idle');
  events.close();
});

test('在跑时发消息进排队，立即发送、撤回、叫停都走接口；同一个 requestId 重发回同一个结果', async () => {
  const gate = deferred<string>();
  const { t, cookie, faux } = await lineApp([slowTool(() => gate.promise)]);
  faux.appendResponses([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查' }, { id: 's1' })], { stopReason: 'toolUse' }),
  ]);
  await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(), text: '查一下' } });
  for (let tries = 0; tries < 200 && t.app.deps.lines?.view('main').activity !== '慢慢做：查…'; tries += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const body = { requestId: requestId(), text: '再看看开机自启' };
  const queued = await call(t, 'POST', lineMessagesPath('main'), { cookie, body });
  assert.equal(json(queued)['outcome'], 'queued');
  const again = await call(t, 'POST', lineMessagesPath('main'), { cookie, body });
  assert.deepEqual(again.body, queued.body);
  assert.equal(again.headers.get('x-plasticine-replayed'), '1');
  const item = json(queued)['queued'] as { id: string };
  const other = json(await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: requestId(), text: '撤掉这句' } }))['queued'] as { id: string };
  const withdrawn = await call(t, 'POST', `${lineQueuePath('main', other.id)}/withdraw`, { cookie,
    body: { requestId: requestId() } });
  assert.equal((json(withdrawn)['item'] as { status: string }).status, 'withdrawn');
  const withdrawAgain = await call(t, 'POST', `${lineQueuePath('main', other.id)}/withdraw`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(withdrawAgain.status, 409);
  const now = await call(t, 'POST', `${lineQueuePath('main', item.id)}/send-now`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(now.status, 200);
  const stopped = await call(t, 'POST', `${linePath('main')}/stop`, { cookie, body: { requestId: requestId() } });
  assert.equal(stopped.status, 200);
  await settled(t);
  const read = json(await call(t, 'GET', linePath('main'), { cookie }));
  assert.equal((read['line'] as { status: string }).status, 'paused');
  assert.equal((read['line'] as { pauseReason: string }).pauseReason, 'user');
  faux.appendResponses([fauxAssistantMessage('继续完成。')]);
  const retry = await call(t, 'POST', `${linePath('main')}/retry`, { cookie, body: { requestId: requestId() } });
  assert.equal(retry.status, 200, '暂停的线可明确继续');
  await settled(t);
  const missing = await call(t, 'GET', linePath('line-nope'), { cookie });
  assert.equal(missing.status, 404);
  gate.resolve('好');
});

function widgetStep(t: TestApp, widgets: unknown[]): void {
  const { state } = t.app.deps;
  state.lineMessages.append('line-main', 'assistant', { role: 'assistant', content: [{ type: 'toolCall', id: 'w1',
    name: 'show_widgets', arguments: {} }], api: 'faux', provider: 'faux', model: 'faux', usage: { input: 0, output: 0,
    cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: 0 });
  state.lineMessages.append('line-main', 'toolResult', { role: 'toolResult', toolCallId: 'w1',
    toolName: 'show_widgets', content: [{ type: 'text', text: '放好了' }], details: { widgets }, isError: false,
    timestamp: 0 });
}

const CHOICE = { kind: 'choice', id: 'wd_choice', prompt: '先做哪个？', multiple: false, answer: null,
  options: [{ id: 'o1', label: '先写测试', recommended: true }, { id: 'o2', label: '先改界面' }] };

test('答线上的选项部件：答案写回那一步，「选择：…」作为一句话发进线，同一个 requestId 重发不重做', async () => {
  const { t, cookie, faux } = await lineApp();
  widgetStep(t, [CHOICE]);
  faux.appendResponses([fauxAssistantMessage([fauxText('好，先写测试。')])]);
  const id = requestId();
  const body = { requestId: id, widgetId: 'wd_choice', answer: { kind: 'choice', optionIds: ['o1'] } };
  const answered = await call(t, 'POST', `${linePath('main')}/widgets`, { cookie, body });
  assert.equal(answered.status, 200);
  assert.equal(json(answered)['outcome'], 'started');
  const widgets = (json(answered)['message'] as { widgets: { answer: unknown }[] }).widgets;
  assert.deepEqual(widgets[0]?.answer, ['o1']);
  await settled(t);
  const again = await call(t, 'POST', `${linePath('main')}/widgets`, { cookie, body });
  assert.equal(again.status, 200);
  const read = json(await call(t, 'GET', `${linePath('main')}?limit=20`, { cookie }));
  const said = (read['messages'] as { role: string; text: string }[]).filter((message) => message.role === 'user');
  assert.deepEqual(said.map((message) => message.text), ['选择：先写测试（「先做哪个？」）']);
  const step = (read['messages'] as { role: string; widgets: { answer: unknown }[] }[])
    .find((message) => message.role === 'toolResult');
  assert.deepEqual(step?.widgets[0]?.answer, ['o1'], '刷新后答案还在');
});

test('线上的记账卡点确认才记上一笔、撤销拿掉，只记结果不开一轮；不认识的部件 404', async () => {
  const { t, cookie } = await lineApp();
  widgetStep(t, [{ kind: 'tool', id: 'wd_money', tool: 'money', state: 'draft', amountCents: 2_800,
    currency: 'CNY', category: '餐饮', note: '午饭', occurredAt: '2026-11-05T04:00:00.000Z',
    monthCategoryCents: null, recordId: null }]);
  const path = `${linePath('main')}/widgets`;
  const confirmed = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), widgetId: 'wd_money',
    answer: { kind: 'decision', value: 'confirm' } } });
  assert.equal(confirmed.status, 200);
  assert.equal(json(confirmed)['outcome'], 'recorded');
  const card = (json(confirmed)['message'] as { widgets: { state: string; recordId: string }[] }).widgets[0];
  assert.equal(card?.state, 'done');
  assert.equal(t.app.deps.state.moneyEntries.get(card.recordId)?.amountCents, 2_800);
  const undone = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), widgetId: 'wd_money',
    answer: { kind: 'decision', value: 'undo' } } });
  assert.equal(undone.status, 200);
  assert.notEqual(t.app.deps.state.moneyEntries.get(card.recordId)?.deletedAt ?? null, null);
  const read = json(await call(t, 'GET', `${linePath('main')}?limit=20`, { cookie }));
  assert.equal((read['messages'] as { role: string }[]).some((message) => message.role === 'user'), false);
  const missing = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), widgetId: 'wd_nope',
    answer: { kind: 'decision', value: 'confirm' } } });
  assert.equal(missing.status, 404);
});

test('带引用发：整页长的引用结构化交给服务端，不占这句话的 2 万字；存下的正文引用在前、话在后', async () => {
  const { t, cookie, faux } = await lineApp();
  faux.appendResponses([fauxAssistantMessage([fauxText('读完了。')])]);
  const page = '页'.repeat(30_000);
  const sent = await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(),
    text: '这页讲了什么？', quotes: [{ kind: 'text', label: '当前页', text: page }] } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body).slice(0, 200));
  const text = (json(sent)['message'] as { text: string }).text;
  assert.ok(text.startsWith('> 〔引用〕当前页\n> 页'));
  assert.ok(text.endsWith('\n\n这页讲了什么？'));
  assert.ok(text.length > 30_000);
  await settled(t);
  const tooLong = await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(),
    text: '字'.repeat(20_001) } });
  assert.equal(tooLong.status, 400, '一句话本身还是 2 万字以内');
});

test('归档接口须登录并幂等，默认列表隐藏但可读取和恢复，旧继续入口被拒绝', async () => {
  const { t, cookie } = await lineApp();
  const kernel = t.app.deps.lines!;
  const line = kernel.open({ title: '已取消', goal: '保留原话', parentLineId: null, projectId: null }, () => undefined);
  kernel.halt(line.id);
  const path = `${linePath(line.id)}/archive`;
  const body = { requestId: requestId() };
  assert.equal((await call(t, 'POST', path, { body })).status, 401);
  const first = await call(t, 'POST', path, { cookie, body });
  assert.equal(first.status, 200);
  const replay = await call(t, 'POST', path, { cookie, body });
  assert.deepEqual(json(replay), json(first));
  const active = json(await call(t, 'GET', LINES_PATH, { cookie }));
  assert.ok(Value.Check(ListLinesResponseSchema, active));
  assert.ok(!active.lines.some((item) => item.id === line.id));
  const all = json(await call(t, 'GET', `${LINES_PATH}?includeArchived=true`, { cookie }));
  assert.ok(Value.Check(ListLinesResponseSchema, all));
  assert.ok(all.lines.some((item) => item.id === line.id && item.archivedAt != null));
  assert.equal((await call(t, 'GET', linePath(line.id), { cookie })).status, 200);
  assert.equal((await call(t, 'POST', `${linePath(line.id)}/retry`, {
    cookie, body: { requestId: requestId() },
  })).status, 409);
  assert.equal((await call(t, 'POST', lineMessagesPath(line.id), {
    cookie, body: { requestId: requestId(), text: '不要执行' },
  })).status, 409);
  assert.equal((await call(t, 'POST', `${linePath(line.id)}/restore`, {
    cookie, body: { requestId: requestId() },
  })).status, 200);
  assert.equal(kernel.view(line.id).archivedAt, null);
  assert.equal(kernel.view(line.id).status, 'paused');
});
