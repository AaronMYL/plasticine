import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { mailTool, until } from '../lines/helpers.ts';
import { OutboundGrantResponseSchema, OutboundGrantListResponseSchema } from '../../shared/api/outbound.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const grant = { actor: MAIN_LINE_ID, channel: 'fixture.mail', account: 'fixture-account',
  recipientMode: 'list', recipients: ['recipient-fixture'], category: 'reply', fixedTexts: null,
  scope: { kind: 'always' }, expiresAt: null };

test('本人管理授权：创建、列表、版本编辑、撤销，匿名不能读写', async () => {
  app = await startTestApp([], { startTasks: false });
  assert.equal((await call(app, 'GET', '/v2/outbound/grants')).status, 401);
  const cookie = await pair(app);
  const created = await call(app, 'POST', '/v2/outbound/grants', { cookie,
    body: { requestId: 'outbound-create-one', grant } });
  assert.equal(created.status, 201);
  assert.ok(Value.Check(OutboundGrantResponseSchema, created.body));
  const row = created.body.grant;
  assert.notEqual(row.confirmedByDeviceId, '');
  const listed = await call(app, 'GET', '/v2/outbound/grants', { cookie });
  assert.ok(Value.Check(OutboundGrantListResponseSchema, listed.body));
  assert.equal(listed.body.grants.length, 1);
  const edited = await call(app, 'PUT', `/v2/outbound/grants/${row.id}`, { cookie,
    body: { requestId: 'outbound-edit-one', version: row.version, patch: { recipients: ['second-fixture'] } } });
  assert.ok(Value.Check(OutboundGrantResponseSchema, edited.body));
  assert.deepEqual(edited.body.grant.recipients, ['second-fixture']);
  assert.equal((await call(app, 'PUT', `/v2/outbound/grants/${row.id}`, { cookie,
    body: { requestId: 'outbound-stale-one', version: row.version, patch: { enabled: false } } })).status, 409);
  const revoked = await call(app, 'POST', `/v2/outbound/grants/${row.id}/revoke`, { cookie,
    body: { requestId: 'outbound-revoke-one', version: edited.body.grant.version } });
  assert.ok(Value.Check(OutboundGrantResponseSchema, revoked.body));
  assert.notEqual(revoked.body.grant.revokedAt, null);
  assert.equal(revoked.body.grant.enabled, false);
});

test('空名单和客户端伪造确认来源不会建授权', async () => {
  app = await startTestApp([], { startTasks: false });
  const cookie = await pair(app);
  assert.equal((await call(app, 'POST', '/v2/outbound/grants', { cookie,
    body: { requestId: 'outbound-empty-one', grant: { ...grant, recipients: [] } } })).status, 400);
  assert.equal((await call(app, 'POST', '/v2/outbound/grants', { cookie,
    body: { requestId: 'outbound-forged-one', grant, confirmedByDeviceId: 'fake-device' } })).status, 400);
  assert.equal(app.state.outboundGrants.list().length, 0);
});

test('范围卡能提交长期范围，之后同范围不再出卡，原文可从记录接口读取', async () => {
  const sent: string[] = [];
  app = await startTestApp([], { startTasks: false, lines: { tools: () => [{ ...mailTool(sent),
    outbound: (args) => ({ channel: 'fixture.mail', account: 'fixture-account', category: 'reply',
      recipients: [String(args.to)], content: String(args.body) }),
  }] } });
  const cookie = await pair(app);
  const send = (id: string) => [
    fauxAssistantMessage([fauxToolCall('send_mail', { to: 'recipient-fixture', body: '测试原文' }, { id })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('完成'),
  ];
  app.respond(send('fixture-first'));
  app.app.deps.lines.send('main', { text: '发送测试' });
  await until(() => app!.state.asks.open().length > 0, '显示授权卡');
  const ask = app.state.asks.open()[0]!;
  const response = await call(app, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: 'outbound-card-allow', optionId: 'allow', outboundGrant: grant } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  await app.app.deps.lines.settled();
  assert.deepEqual(sent, ['recipient-fixture:测试原文']);
  app.respond(send('fixture-second'));
  app.app.deps.lines.send('main', { text: '再发一次测试' });
  await app.app.deps.lines.settled();
  assert.equal(sent.length, 2);
  assert.equal(app.state.asks.open().length, 0);
  const entries = app.state.outboundLog.list();
  assert.equal(entries.length, 2);
  const read = await call(app, 'GET', `/v2/outbound/log/${entries[0]!.id}`, { cookie });
  assert.equal(read.status, 200);
  assert.equal((read.body as { entry: { content: string } }).entry.content, '测试原文');
});
