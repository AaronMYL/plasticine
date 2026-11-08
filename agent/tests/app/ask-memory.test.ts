import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type ToolResultMessage } from '@earendil-works/pi-ai';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { questionAnswerOrigin } from '../../src/lines/ask-tools.ts';
import { until } from '../lines/helpers.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function answerQuestion(t: TestApp, text: string): Promise<string> {
  const cookie = await pair(t);
  const sent = await call(t, 'POST', '/v2/lines/main/messages', { cookie,
    body: { requestId: 'ask-memory-start-001', text: '先问清楚我的情况，再记下来。' } });
  assert.equal(sent.status, 200);
  await until(() => t.state.asks.open().some((ask) => ask.purpose === 'line_question'), '用户问题卡');
  const ask = t.state.asks.open().find((row) => row.purpose === 'line_question');
  assert.ok(ask !== undefined);
  const answered = await call(t, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: 'ask-memory-answer-001', text } });
  assert.equal(answered.status, 200);
  await t.app.deps.lines.settled();
  return ask.id;
}

test('用户回答问题卡后，当场记住的偏好链回真实回答，保留原话来源', async () => {
  const t = await startTestApp();
  app = t;
  t.respond([
    fauxAssistantMessage([fauxToolCall('ask_user', {
      kind: 'act', question: '你平时喜欢什么运动？', options: [], basis: 'missing',
    }, { id: 'ask-habit' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('remember', {
      text: '喜欢早上跑步', quote: '早上跑步',
    }, { id: 'remember-habit' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('已经记下。'),
  ]);
  const original = '  我喜欢早上跑步。\n周末也一样。';
  const askId = await answerQuestion(t, original);
  const remembered = t.state.memoryDocs.lines.allLive().find((row) => row.text === '喜欢早上跑步');
  assert.ok(remembered !== undefined, '真实回答可以成为 remember 的来源');
  const source = t.state.lineMessages.said(remembered.anchors[0]?.ref ?? '');
  assert.equal(source?.role, 'toolResult', '不在工具调用与结果之间补造一条用户消息');
  assert.deepEqual(source?.origin, { kind: 'user', ref: `ask:${askId}`, userText: original });
  assert.equal(t.state.asks.get(askId)?.answer?.text, original);
});

test('问题卡的真实回答进入后台记忆整理（今天的记录），材料只带用户答案并链回该结果', async () => {
  let answerRef = '';
  const original = '我住在杭州，明年也会住在这里。';
  const t = await startTestApp([async (request) => {
    const material = JSON.parse(String(request.messages[0]?.content)) as {
      turn: { user: { id: string; text: string }[] };
    };
    const answered = material.turn.user.find((source) => source.text === original);
    assert.ok(answered !== undefined, '整理材料必须包含卡片原始回答，不能只有发问前的消息');
    assert.ok(material.turn.user.every((source) => !source.text.includes('他回答：')));
    answerRef = answered.id;
    return { text: JSON.stringify({ notes: [{ kind: 'fact', doc: YOU_DOC_ID, text: '住在杭州',
      sources: [answered.id] }], used: [] }), complete: true };
  }], { memoryCuration: true });
  app = t;
  t.respond([
    fauxAssistantMessage([fauxToolCall('ask_user', {
      kind: 'act', question: '你现在住在哪里？', options: [], basis: 'missing',
    }, { id: 'ask-home' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('知道了。'),
  ]);
  const askId = await answerQuestion(t, original);
  await t.app.deps.memoryCurator.settled();
  const remembered = t.state.memoryJournal.open().find((row) => row.text === '住在杭州');
  assert.ok(remembered !== undefined, '后台应从真实卡片回答记下今天的记录');
  assert.deepEqual(remembered.anchors, [{ kind: 'message', ref: answerRef }]);
  assert.deepEqual(t.state.lineMessages.said(answerRef)?.origin,
    { kind: 'user', ref: `ask:${askId}`, userText: original });
});

test('工具不能借别条线或别次调用的已答卡冒充用户，原话以卡里认证答案为准', async () => {
  const t = await startTestApp();
  app = t;
  const cookie = await pair(t);
  const lineId = t.state.lines.main().id;
  const toolCallId = 'real-question';
  const ask = t.app.deps.desk.commit((changes) => t.app.deps.desk.raise(changes, {
    kind: 'act', purpose: 'line_question', question: '你现在住在哪里？', options: [],
    actionId: `line-ask:${lineId}:${toolCallId}`, context: { lineId, toolCallId }, basis: 'missing',
  }));
  const answered = await call(t, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: 'ask-origin-answer-001', text: '我住在杭州。' } });
  assert.equal(answered.status, 200);
  const result: ToolResultMessage = { role: 'toolResult', toolName: 'ask_user', toolCallId, isError: false,
    content: [{ type: 'text', text: '工具包装的内容不能替换真实答案。' }], details: { askId: ask.id }, timestamp: 1 };
  assert.deepEqual(questionAnswerOrigin(t.state, lineId, result),
    { kind: 'user', ref: `ask:${ask.id}`, userText: '我住在杭州。' });
  assert.equal(questionAnswerOrigin(t.state, 'another-line', result), undefined);
  assert.equal(questionAnswerOrigin(t.state, lineId, { ...result, toolCallId: 'another-call' }), undefined);
  assert.equal(questionAnswerOrigin(t.state, lineId, { ...result, toolName: 'read_page' }), undefined);
  assert.equal(questionAnswerOrigin(t.state, lineId, { ...result, details: { askId: 'missing' } }), undefined);
  assert.equal(questionAnswerOrigin(t.state, lineId, { ...result, isError: true }), undefined);
  const saved = t.state.asks.require(ask.id);
  t.state.asks.update(saved.id, saved.version, { answeredByDeviceId: null });
  assert.equal(questionAnswerOrigin(t.state, lineId, result), undefined, '没有真实作答设备时不能恢复用户身份');
});
