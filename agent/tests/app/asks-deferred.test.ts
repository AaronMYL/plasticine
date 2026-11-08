import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { AskListResponseSchema, AskViewSchema, HomeResponseSchema }
  from '../../shared/api/index.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); });

test('三已答三暂缓：待答为零，原题历史原封保留，暂缓卡可按原标识找回', async () => {
  app = await startTestApp([], { startTasks: false });
  const cookie = await pair(app);
  const { state, desk } = app.app.deps;
  for (let index = 0; index < 3; index += 1) {
    const ask = state.asks.create({ kind: 'decide', purpose: 'line_question', channel: 'popup',
      question: `已回答的问题 ${index}`, options: [] });
    desk.answer({ askId: ask.id, text: `已在主对话说明 ${index}`, answerer: { deviceId: 'test-device' } });
  }
  const deferred = Array.from({ length: 3 }, (_, index) => {
    const ask = state.asks.create({ kind: 'decide', purpose: 'line_question', channel: 'popup',
      question: `保留的原问题 ${index}`, detail: '原始依据与上下文', options: [] });
    return desk.defer(ask.id);
  });
  const listed = await call(app, 'GET', '/v2/asks', { cookie });
  assert.ok(Value.Check(AskListResponseSchema, listed.body));
  assert.equal(listed.body.current, null);
  assert.deepEqual(listed.body.queue, []);
  assert.deepEqual(listed.body.deferred?.map((ask) => ask.id),
    deferred.map((ask) => ask.id));
  const home = await call(app, 'GET', '/v2/home', { cookie });
  assert.ok(Value.Check(HomeResponseSchema, home.body));
  assert.deepEqual(home.body.pinned, [], '推迟的卡不钉在首页');
  for (const ask of deferred) {
    const found = await call(app, 'GET', `/v2/asks/${ask.id}`, { cookie });
    assert.ok(Value.Check(AskViewSchema, found.body));
    assert.equal(found.body.question, ask.question);
    assert.equal(found.body.detail, ask.detail);
    assert.equal(found.body.status, 'open');
    assert.equal(found.body.answer, null);
    assert.equal(found.body.deferredAt, ask.deferredAt);
    assert.deepEqual(state.asks.require(ask.id), ask, '读列表不写卡、不改历史');
  }
});
