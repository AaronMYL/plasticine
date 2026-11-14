// 预测消息（11-13）：/v2/compose/predict 按线 / 联系人现读最近的消息；轮到他说才给整句；来信不猜；结果报一次。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import { ComposePredictStreamEventSchema, type ComposePredictStreamEvent } from '../../shared/api/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { call, json, pair, startTestApp, type ApiReply, type TestApp } from './helpers.ts';

let t: TestApp;
let cookie: string;

before(async () => {
  t = await startTestApp(['那现在还用得着吗？', '好的，我去看看', '好，周四晚上我看第一版']);
  cookie = await pair(t);
});
after(() => t.close());

function events(reply: ApiReply): ComposePredictStreamEvent[] {
  const text = Buffer.from(reply.body as ArrayBuffer).toString();
  return text.split('\n\n').filter((frame) => frame.trim() !== '').map((frame) => {
    const value: unknown = JSON.parse(frame.slice('data: '.length));
    assert.ok(Value.Check(ComposePredictStreamEventSchema, value), frame);
    return value;
  });
}

function done(reply: ApiReply): { text: string; loopId?: string } {
  const last = events(reply).at(-1);
  assert.equal(last?.type, 'done');
  return last?.type === 'done' ? last.view : { text: '' };
}

const predict = (target: unknown, draft = '') => call(t, 'POST', '/v2/compose/predict',
  { cookie, body: { target, draft } });

test('main line: after his own message it is not his turn; after Plasticine answers it gives a sentence', async () => {
  const main = MAIN_LINE_ID;
  t.state.lineMessages.append(main, 'user', { role: 'user', content: '它是什么时候装上的？', timestamp: 1 },
    { origin: { kind: 'user', userText: '它是什么时候装上的？' } });
  assert.deepEqual(done(await predict({ kind: 'line', id: main })), { text: '' });
  t.state.lineMessages.append(main, 'assistant', fauxAssistantMessage('10 月 28 日装的。'));
  const view = done(await predict({ kind: 'line', id: main }));
  assert.equal(view.text, '那现在还用得着吗？');
  assert.ok(view.loopId !== undefined);
  const report = (outcome: string) => call(t, 'POST', '/v2/compose/outcome',
    { cookie, body: { loopId: view.loopId, outcome } });
  assert.deepEqual(json(await report('kept')), { resolved: true });
  assert.deepEqual(json(await report('rejected')), { resolved: false });
  assert.equal(t.state.loop.tallies('message_predict')[0]?.kept, 1);
});

test('main line: a background report that came back last counts as Plasticine speaking, so it is his turn', async () => {
  const main = MAIN_LINE_ID;
  t.state.lineMessages.append(main, 'user', { role: 'user', content: '帮我加几个信息源', timestamp: 2 },
    { origin: { kind: 'user', userText: '帮我加几个信息源' } });
  assert.deepEqual(done(await predict({ kind: 'line', id: main })), { text: '' });
  t.state.lineMessages.append(main, 'lineReport', { role: 'lineReport', lineId: 'line-feeds', title: '加信息源',
    outcome: 'done', text: '六个来源都加好了。', timestamp: 3 });
  assert.equal(done(await predict({ kind: 'line', id: main })).text, '好的，我去看看');
});

test('a contact: the friend spoke last, so it is his turn', async () => {
  const contact = t.state.contacts.create({ accountId: 'acct-lin', handle: 'linyi', displayName: '林一',
    signingKey: 'sig', encryptionKey: 'enc', state: 'active', lastAt: '2026-11-13T10:00:00.000Z' });
  t.state.contactMessages.create({ contactId: contact.id, direction: 'in', author: 'them', kind: 'text',
    text: '样例收到了，第一版周四晚上能给你', payload: { text: '样例收到了', replyTo: null },
    sentAt: '2026-11-13T10:00:00.000Z', status: 'sent' });
  assert.equal(done(await predict({ kind: 'contact', id: contact.id })).text, '好，周四晚上我看第一版');
});

test('mail threads are not guessed, unknown places are 404, bad input is 400', async () => {
  assert.deepEqual(done(await predict({ kind: 'contact', id: 'mail:someone@example.com' })), { text: '' });
  assert.equal((await predict({ kind: 'contact', id: 'nobody' })).status, 404);
  assert.equal((await predict({ kind: 'room', id: 'x' })).status, 400);
});
