// 《优化清单》第 17 条的接口：开旁聊（空白、信息流「讨论」、主线里的一句）、第二栏列表、表情、回复某一条。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import { CHATS_PATH, ChatsResponseSchema, lineMessagesPath, lineReactionsPath, SIDE_PATH }
  from '../../shared/api/index.ts';
import type { ModelSource } from '../../src/lines/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

async function sideApp() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: models.streamSimple.bind(models),
    complete: (model, context) => models.completeSimple(model, context),
  };
  const t = await startTestApp([], { lines: { models: source } });
  apps.push(t);
  return { t, cookie: await pair(t), faux };
}

let counter = 0;
function requestId(): string {
  counter += 1;
  return `side-request-${String(counter).padStart(4, '0')}`;
}

test('旧创建入口停止接受新对话，旧记录仍可读取', async () => {
  const { t, cookie } = await sideApp();
  assert.equal((await call(t, 'POST', SIDE_PATH, { body: { requestId: requestId() } })).status, 401);
  assert.equal((await call(t, 'POST', SIDE_PATH, { cookie,
    body: { requestId: requestId() } })).status, 410);
  const old = t.app.deps.lines.openSide({ title: '旧记录', topic: null });
  const chats = await call(t, 'GET', CHATS_PATH, { cookie });
  assert.ok(Value.Check(ChatsResponseSchema, chats.body));
  assert.equal(chats.body.sides[0]?.id, old.id);
});

test('回复某一条；表情加上又拿掉', async () => {
  const { t, cookie, faux } = await sideApp();
  faux.appendResponses([fauxAssistantMessage('收入门槛今年改成按月算了。'), fauxAssistantMessage('那就按月平均。')]);
  await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(), text: '签证' } });
  await t.app.deps.lines?.settled();
  const reply = await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(),
    text: '我是按项目结的', replyTo: { seq: 2 } } });
  assert.equal(reply.status, 200);
  const message = json(reply)['message'] as { text: string; replyTo: { author: string } };
  assert.equal(message.text, '我是按项目结的');
  assert.equal(message.replyTo.author, 'Plasticine');
  await t.app.deps.lines?.settled();
  const path = lineReactionsPath('main');
  const on = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), seq: 2, emoji: '👍', on: true } });
  assert.deepEqual((json(on)['message'] as { reactions: string[] }).reactions, ['👍']);
  const off = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), seq: 2, emoji: '👍', on: false } });
  assert.deepEqual((json(off)['message'] as { reactions: string[] }).reactions, []);
  const bad = await call(t, 'POST', path, { cookie, body: { requestId: requestId(), seq: 2, emoji: 'x', on: true } });
  assert.equal(bad.status, 400);
});
