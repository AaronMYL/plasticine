import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPLAYED_HEADER } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('建议原文落进反馈分类；快速重放、换页全文搜索和读取都指向同一封，不能复用标识改文', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const body = { requestId: 'feedback-browser-once', text: '需要能读完整原文\n正文里的唯一搜索词：麋鹿时间线。' };
    const first = await call(app, 'POST', '/v2/inbox/feedback', { cookie, body });
    assert.equal(first.status, 201);
    const again = await call(app, 'POST', '/v2/inbox/feedback', { cookie, body });
    assert.equal(again.headers.get(REPLAYED_HEADER), '1');
    assert.deepEqual(again.body, first.body);
    assert.equal(app.state.inboxMessages.page({ box: 'feedback' }, {}).length, 1);
    const searched = json(await call(app, 'GET', `/v2/inbox?box=feedback&q=${encodeURIComponent('麋鹿时间线')}`,
      { cookie }));
    assert.equal(searched['total'], 1);
    const message = app.state.inboxMessages.page({ box: 'feedback' }, {})[0]!;
    const full = json(await call(app, 'GET', `/v2/inbox/${message.id}`, { cookie }));
    assert.equal(full['body'], body.text);
    assert.equal((await call(app, 'POST', '/v2/inbox/feedback', { cookie,
      body: { ...body, text: '另一句话' } })).status, 409);
    assert.equal(app.state.inboxReplies.forMessage(message.id).length, 0);
  } finally { await app.close(); }
});

test('现在收信只报告本次真实结果；未配置、具体失败和成功更新时间均可复验，失败不清已有信', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const body = { requestId: 'inbox-sync-isolated' };
    assert.equal((await call(app, 'POST', '/v2/inbox/sync', { cookie, body })).status, 409);
    const sync = app.app.deps.m5b.cloud.mailSync;
    sync.configured = () => true;
    // HTTP behavior is isolated from the real account; MailSync's IMAP handling has its own transport tests.
    sync.sync = async () => { throw new Error('隔离 IMAP：服务器断开连接'); };
    const existing = app.state.inboxMessages.add({ source: 'email', fromAddress: 'example@example.test',
      title: '保留的信', body: '既有内容', receivedAt: app.clock.now().toISOString() }).message;
    const failed = await call(app, 'POST', '/v2/inbox/sync', { cookie, body });
    assert.equal(failed.status, 502);
    assert.match(String(json(failed)['error']), /隔离 IMAP：服务器断开连接/);
    assert.ok(app.state.inboxMessages.get(existing.id));
    const at = app.clock.now().toISOString();
    sync.sync = async () => {
      app.state.inboxSync.record({ lastSyncAt: at, lastCount: 0, lastError: null });
      return 0;
    };
    const success = json(await call(app, 'POST', '/v2/inbox/sync', { cookie, body }));
    assert.equal(success['added'], 0);
    assert.equal((success['sync'] as { lastSyncAt: string }).lastSyncAt, at);
    assert.equal(app.state.inboxMessages.page({ box: 'all' }, {}).length, 1);
  } finally { await app.close(); }
});
