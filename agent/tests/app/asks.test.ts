import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import {
  AnswerAskResponseSchema,
  AskListResponseSchema,
  PushKeyResponseSchema,
  REPLAYED_HEADER,
  type AskView,
  type PushPayload,
} from '../../shared/api/index.ts';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { fakeBrowser } from '../attention/helpers.ts';
import { holdingLine } from '../../src/network/index.ts';
import { call, json, openEvents, pair, startTestApp, type SseStream, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
const streams: SseStream[] = [];

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.close();
  }
  await t?.close();
  t = undefined;
});

const QUESTION = '周报发给谁？';

test('卡事件带下一张当前卡和等你总数，先不与作答都即时改变', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  const first = t.state.asks.create({
    kind: 'decide', purpose: 'line_question', channel: 'popup', question: '第一张', options: [],
  });
  t.clock.advance(1);
  const second = t.state.asks.create({
    kind: 'decide', purpose: 'line_question', channel: 'popup', question: '第二张', options: [],
  });
  await call(t, 'POST', `/v2/asks/${first.id}/defer`, { cookie, body: { requestId: 'event-defer-0001' } });
  const deferred = (await events.next('ask_updated')).event;
  assert.ok(deferred.type === 'ask_updated');
  assert.equal(deferred.currentId, second.id);
  assert.equal(deferred.waitingOnYouCount, 1);
  await call(t, 'POST', `/v2/asks/${second.id}/answer`, {
    cookie, body: { requestId: 'event-answer-001', text: '知道了' },
  });
  const answered = (await events.next('ask_answered')).event;
  assert.ok(answered.type === 'ask_answered');
  assert.equal(answered.currentId, null);
  assert.equal(answered.waitingOnYouCount, 0);
});

test('推送状态只返回当前设备是否订阅，不返回订阅端点或加密参数', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const before = await call(t, 'GET', '/v2/push/subscriptions', { cookie });
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, { subscribed: false });
});

async function subscribe(app: TestApp, cookie: string): Promise<SseStream> {
  const stream = await openEvents(app, cookie);
  streams.push(stream);
  return stream;
}

async function nextAsk(stream: SseStream): Promise<AskView> {
  const frame = await stream.next('ask_created');
  assert.ok(frame.event.type === 'ask_created');
  return frame.event.ask;
}

/** 主线上的一张问卡（线上的 ask_user 出的那种），runId 指回主线。 */
function raise(app: TestApp, channel: 'popup' | 'interrupt' = 'popup'): void {
  const { desk } = app.app.deps;
  desk.commit((changes) => desk.raise(changes, { kind: 'decide', purpose: 'line_question', question: QUESTION,
    options: [{ id: 'team', label: '发给组里', recommended: true }, { id: 'boss', label: '只发老板' }],
    runId: 'line:line-main', channel }));
}

test('先不：卡收回清单、另一台设备同步；问一句：把问题发进出卡的那条线，卡还开着', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  t.respond([fauxAssistantMessage('收件人是你定的。')]);
  raise(t);
  const ask = await nextAsk(events);
  const deferred = await call(t, 'POST', `/v2/asks/${ask.id}/defer`, { cookie, body: { requestId: 'req-defer-0001' } });
  assert.equal(deferred.status, 200);
  const updated = await events.next('ask_updated');
  assert.ok(updated.event.type === 'ask_updated' && updated.event.ask.deferredAt !== null);
  const board = json(await call(t, 'GET', '/v2/asks', { cookie })) as { current: unknown; queue: { id: string }[];
    deferred: { id: string }[] };
  assert.equal(board.current, null);
  assert.deepEqual(board.queue, []);
  assert.deepEqual(board.deferred.map((entry) => entry.id), [ask.id]);

  const asked = await call(t, 'POST', `/v2/asks/${ask.id}/ask`, {
    cookie,
    body: { requestId: 'req-about-0001', text: '老板是谁？' },
  });
  assert.equal(asked.status, 202);
  const body = json(asked) as { lineId: string };
  assert.equal(body.lineId, 'line-main');
  const said = t.state.lineMessages.said('line:line-main:1');
  assert.equal(said?.text, `关于「${QUESTION}」：老板是谁？`);
  assert.equal(t.state.asks.get(ask.id)?.status, 'open');
});

test('卡带着出它的那条线（lineId）：线上出的指回那条线，别处出的（重新登录、记账确认）是 null', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  raise(t);
  const fromLine = await nextAsk(events);
  assert.equal(fromLine.lineId, 'line-main');
  const { desk } = t.app.deps;
  desk.commit((changes) => desk.raise(changes, { kind: 'confirm', purpose: 'money_confirmation', question: '这笔记成餐饮？',
    options: [], channel: 'popup' }));
  const elsewhere = await nextAsk(events);
  assert.equal(elsewhere.lineId, null);
  const listed = json(await call(t, 'GET', `/v2/asks/${fromLine.id}`, { cookie })) as { lineId: string | null };
  assert.equal(listed.lineId, 'line-main');
  for (const gone of ['taskId', 'taskTitle', 'interviewId', 'judgmentId', 'selfChangeId', 'activation',
    'matterRouting']) {
    assert.equal(gone in fromLine, false, gone);
  }
});

test('卡的接口：没登录 401，没有的卡 404，选了没有的选项 400', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  assert.equal((await call(t, 'GET', '/v2/asks')).status, 401);
  assert.equal((await call(t, 'GET', '/v2/asks/nope', { cookie })).status, 404);
  raise(t);
  const ask = await nextAsk(events);
  const wrong = await call(t, 'POST', `/v2/asks/${ask.id}/answer`, {
    cookie,
    body: { requestId: 'req-wrong-0001', optionId: 'nobody' },
  });
  assert.equal(wrong.status, 400);
  assert.equal(json(wrong)['field'], 'optionId');
  assert.equal((await call(t, 'GET', `/v2/asks/${ask.id}`, { cookie })).status, 200);
});

test('干跑时立刻打断照常发：订阅设备收到只有一句话和链接的通知；退订后不再收到', async () => {
  t = await startTestApp([], { dryRun: true });
  const cookie = await pair(t);
  const key = await call(t, 'GET', '/v2/push/key', { cookie });
  assert.ok(Value.Check(PushKeyResponseSchema, key.body));
  assert.equal(key.body.publicKey, t.vapidKeys.publicKey);
  const browser = fakeBrowser();
  const endpoint = 'https://push.example.com/send/device-1';
  const subscribed = await call(t, 'POST', '/v2/push/subscriptions', {
    cookie,
    body: { requestId: 'req-push-0001', endpoint, keys: browser.keys },
  });
  assert.equal(subscribed.status, 201);
  assert.deepEqual((json(subscribed)['subscription'] as { endpointHost: string }).endpointHost, 'push.example.com');
  assert.equal(JSON.stringify(subscribed.body).includes(browser.keys.auth), false);
  assert.deepEqual((await call(t, 'GET', '/v2/push/subscriptions', { cookie })).body, { subscribed: true });
  const otherCookie = await pair(t, '另一台');
  const otherStatus = await call(t, 'GET', '/v2/push/subscriptions', { cookie: otherCookie });
  assert.deepEqual(otherStatus.body, { subscribed: false });

  const events = await subscribe(t, cookie);
  raise(t, 'interrupt');
  const ask = await nextAsk(events);
  const deadline = Date.now() + 2_000;
  while (t.pushes.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(t.pushes.length, 1);
  const [push] = t.pushes;
  assert.equal(push?.endpoint, endpoint);
  const payload = JSON.parse(browser.decrypt(push?.request.body ?? Buffer.alloc(0))) as PushPayload;
  assert.equal(payload.url, `/?ask=${ask.id}`);
  assert.equal(JSON.stringify(payload).includes('周报'), false);

  const removed = await call(t, 'DELETE', '/v2/push/subscriptions', {
    cookie,
    body: { requestId: 'req-push-0002', endpoint },
  });
  assert.deepEqual(removed.body, { removed: true });
  assert.equal(t.state.pushSubscriptions.active().length, 0);
  assert.deepEqual((await call(t, 'GET', '/v2/push/subscriptions', { cookie })).body, { subscribed: false });
});

test('推送接口：没登录 401；endpoint 不是 https 或钥匙不对 400', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/push/key')).status, 401);
  const plain = await call(t, 'POST', '/v2/push/subscriptions', {
    cookie,
    body: { requestId: 'req-push-0003', endpoint: 'http://push.example.com/x', keys: fakeBrowser().keys },
  });
  assert.equal(plain.status, 400);
  assert.equal(json(plain)['field'], 'endpoint');
  const badKeys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: 'A'.repeat(22) };
  const broken = await call(t, 'POST', '/v2/push/subscriptions', {
    cookie,
    body: { requestId: 'req-push-0004', endpoint: 'https://push.example.com/x', keys: badKeys },
  });
  assert.equal(broken.status, 400);
});

test('要确认怎么回别人的卡：带上属于哪段聊天和草稿；不在任务「等你」里再列一遍', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const reply = t.state.asks.create({
    kind: 'confirm', purpose: 'network_reply', channel: 'popup', question: '周可问你的 Plasticine：能接吗？',
    options: [{ id: 'send', label: '这样回', description: null, recommended: true },
      { id: 'self', label: '我自己回', description: null, recommended: false },
      { id: 'none', label: '不回', description: null, recommended: false }],
    context: { contactId: 'contact-zhou', groupId: null, questionId: 'q-1', draft: '能接。', materials: [] },
  });
  const other = t.state.asks.create({
    kind: 'decide', purpose: 'line_question', channel: 'popup', question: QUESTION, options: [],
  });
  const listed = await call(t, 'GET', '/v2/asks', { cookie });
  assert.ok(Value.Check(AskListResponseSchema, listed.body));
  const body = listed.body;
  const views = new Map([...(body.current === null ? [] : [body.current]), ...body.queue].map((ask) => [ask.id, ask]));
  assert.deepEqual(views.get(reply.id)?.networkReply,
    { contactId: 'contact-zhou', groupId: null, questionId: 'q-1', draft: '能接。' });
  assert.equal(views.get(other.id)?.networkReply, undefined);
  const board = await call(t, 'GET', '/v2/tasks/board', { cookie });
  assert.equal(board.status, 200);
  assert.deepEqual((json(board)['waiting'] as AskView[]).map((ask) => ask.id), [other.id]);
});

test('拿不准时先回的那一句写的是账号上的名字，不写「主人」', () => {
  assert.equal(holdingLine('小蕨'), '我问一下小蕨。');
  assert.equal(holdingLine('Fern'), '我问一下 Fern。');
  assert.equal(holdingLine('  '), '我先问一下，再回你。');
});
