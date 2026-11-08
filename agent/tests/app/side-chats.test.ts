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

test('信息流条目点「讨论」开旁聊：带上那一条，第二栏列出它；同一个请求重发不开第二条', async () => {
  const { t, cookie } = await sideApp();
  assert.equal((await call(t, 'POST', SIDE_PATH, { body: { requestId: requestId() } })).status, 401);
  const feed = t.state.feedSources.create({ kind: 'interest', label: '神经科学', level: 'normal' });
  const item = t.state.feedItems.add({ sourceId: feed.id, origin: 'feed', title: '睡眠中的记忆重放第一次在人脑里被直接测到',
    site: 'bioRxiv', summary: '颅内电极记录 18 名受试者', day: '2026-11-05',
    arrivedAt: t.clock.now().toISOString(), dedupeKey: 'replay' }).item;
  const body = { requestId: requestId(), from: { kind: 'feed', itemId: item.id } };
  const opened = await call(t, 'POST', SIDE_PATH, { cookie, body });
  assert.equal(opened.status, 200);
  const line = json(opened)['line'] as { id: string; kind: string; title: string; topic: { excerpt: string } };
  assert.equal(line.kind, 'side');
  assert.equal(line.title, '讨论：睡眠中的记忆重放第一次在人脑里被直接测到');
  assert.equal(line.topic.excerpt, '颅内电极记录 18 名受试者');
  const again = await call(t, 'POST', SIDE_PATH, { cookie, body });
  assert.equal((json(again)['line'] as { id: string }).id, line.id);
  const chats = await call(t, 'GET', CHATS_PATH, { cookie });
  assert.equal(chats.status, 200);
  assert.ok(Value.Check(ChatsResponseSchema, chats.body));
  assert.deepEqual((json(chats)['sides'] as { id: string }[]).map((side) => side.id), [line.id]);
  const missing = await call(t, 'POST', SIDE_PATH, { cookie, body: { requestId: requestId(),
    from: { kind: 'feed', itemId: 'feed_none' } } });
  assert.equal(missing.status, 404);
});

test('空白旁聊；回复某一条；表情加上又拿掉', async () => {
  const { t, cookie, faux } = await sideApp();
  const blank = json(await call(t, 'POST', SIDE_PATH, { cookie, body: { requestId: requestId() } }));
  assert.equal((blank['line'] as { title: string }).title, '新旁聊');
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
