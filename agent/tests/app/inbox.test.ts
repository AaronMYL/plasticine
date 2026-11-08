import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { InboxMessageInput } from '../../shared/state.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

function seed(app: TestApp, overrides: Partial<InboxMessageInput> = {}): string {
  return app.state.inboxMessages.add({
    source: 'email',
    fromAddress: 'friend@example.com',
    title: '周末见',
    body: '周六下午三点，老地方。',
    receivedAt: app.clock.now().toISOString(),
    messageId: `<${Math.random()}@example.com>`,
    ...overrides,
  }).message.id;
}

test('站内信列表：没登录 401；十个分类按列筛，带铃上的未读数和收信状态（没配就说没配）', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/inbox')).status, 401);
  const cookie = await pair(t);
  seed(t);
  seed(t, { source: 'feedback', messageId: null, fromAddress: '小雨', title: '按钮太小', body: '手机上点不中' });
  const all = json(await call(t, 'GET', '/v2/inbox', { cookie }));
  assert.equal(all['total'], 2);
  assert.equal(((all['unread'] as Body)['total']), 2);
  assert.equal(((all['sync'] as Body)['configured']), false);
  const feedback = json(await call(t, 'GET', '/v2/inbox?box=feedback', { cookie }));
  assert.deepEqual((feedback['messages'] as Body[]).map((row) => row['title']), ['按钮太小']);
  assert.equal((await call(t, 'GET', '/v2/inbox?box=spam', { cookie })).status, 400);
  const searched = json(await call(t, 'GET', `/v2/inbox?q=${encodeURIComponent('老地方')}`, { cookie }));
  assert.equal(searched['total'], 1);
});

test('已读、收藏、归档：带 version，旧了 409；推 inbox_changed 带新的未读数；全部标已读', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const id = seed(t);
  seed(t, { messageId: null, title: '第二封' });
  const events = await openEvents(t, cookie);
  const read = await call(t, 'POST', `/v2/inbox/${id}/flags`, {
    cookie,
    body: { requestId: newRequestId('fl'), version: 1, read: true, starred: true },
  });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(((json(read)['unread'] as Body)['total']), 1);
  const changed = await events.next('inbox_changed');
  events.close();
  assert.ok(changed.event.type === 'inbox_changed' && changed.event.unread.total === 1);
  const stale = await call(t, 'POST', `/v2/inbox/${id}/flags`, {
    cookie,
    body: { requestId: newRequestId('fl'), version: 1, archived: true },
  });
  assert.equal(stale.status, 409);
  const empty = await call(t, 'POST', `/v2/inbox/${id}/flags`, {
    cookie,
    body: { requestId: newRequestId('fl'), version: 2 },
  });
  assert.equal(empty.status, 400);
  const readAll = await call(t, 'POST', '/v2/inbox/read-all', {
    cookie,
    body: { requestId: newRequestId('ra'), box: 'all' },
  });
  assert.equal(json(readAll)['changed'], 1);
});

test('非邮件回复只记站内；重发同一个 requestId 拿回同一条', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const id = seed(t, { source: 'feedback' });
  const opened = json(await call(t, 'GET', `/v2/inbox/${id}`, { cookie }));
  assert.equal(opened['body'], '周六下午三点，老地方。');
  assert.equal(opened['replySends'], false);
  const body = { requestId: newRequestId('rp'), text: '好的' };
  const reply = await call(t, 'POST', `/v2/inbox/${id}/replies`, { cookie, body });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const view = json(reply)['reply'] as Body;
  assert.equal(view['status'], 'stored');
  const again = json(await call(t, 'POST', `/v2/inbox/${id}/replies`, { cookie, body }))['reply'] as Body;
  assert.equal(again['id'], view['id']);
  const conflict = await call(t, 'POST', `/v2/inbox/${id}/replies`, { cookie, body: { ...body, text: '变了' } });
  assert.equal(conflict.status, 409);
  const replies = json(await call(t, 'GET', `/v2/inbox/${id}`, { cookie }))['replies'] as Body[];
  assert.equal(replies.length, 1);
});

test('邮件能回了（第 113 条）：干跑只记不发；关了干跑但邮箱没连上，记成失败、不发', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const id = seed(t);
  const dry = await call(t, 'POST', `/v2/inbox/${id}/replies`, {
    cookie,
    body: { requestId: newRequestId('rp'), text: '好的' },
  });
  assert.equal(dry.status, 201, JSON.stringify(dry.body));
  assert.equal((json(dry)['reply'] as Body)['status'], 'dry_run');
  await t.close();
  t = await startTestApp([], { dryRun: false });
  const live = await pair(t);
  const other = seed(t);
  const reply = await call(t, 'POST', `/v2/inbox/${other}/replies`, {
    cookie: live,
    body: { requestId: newRequestId('rp'), text: '好的' },
  });
  assert.equal(reply.status, 201);
  assert.equal((json(reply)['reply'] as Body)['status'], 'failed');
  assert.equal(t.state.inboxReplies.forMessage(other).length, 1);
});

test('回复结果待核实的，用 settle 说发没发出去', async () => {
  t = await startTestApp([], {
    dryRun: false,
    cloudTransports: {
      mail: {
        send: async () => {
          throw new Error('连接断了');
        },
      },
    },
  });
  const cookie = await pair(t);
  const id = seed(t);
  const reply = t.state.inboxReplies.create({ messageId: id, text: '好的', actionId: 'inbox-reply:historical',
    deviceId: null, status: 'unknown', sentAt: null, error: null });
  const settled = await call(t, 'POST', `/v2/inbox/replies/${reply.id}/settle`, {
    cookie,
    body: { requestId: newRequestId('st'), happened: true },
  });
  assert.equal(((json(settled)['reply'] as Body)['status']), 'sent');
});
