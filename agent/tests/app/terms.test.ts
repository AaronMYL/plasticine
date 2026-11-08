import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp;
let cookie: string;
const fields = { title: '独立合作者', text: '结构相似', scope: '合作方式', termTier: 'metaphor' };

beforeEach(async () => {
  app = await startTestApp();
  cookie = await pair(app);
  app.clock.advance(20 * 60_000);
});
afterEach(async () => app.close());

test('新建词仅为待议，编辑生效词只存提议，本人老会话无钥匙确认原子更新词义与档位', async () => {
  const request = { ...fields, kind: 'term', requestId: 'term-create-0001' };
  const created = await call(app, 'POST', '/v2/agreements', { cookie, body: request });
  assert.equal(created.status, 201);
  assert.deepEqual((await call(app, 'POST', '/v2/agreements', { cookie, body: request })).body, created.body);
  const row = json(created)['agreement'] as Record<string, unknown>;
  const id = String(row['id']);
  assert.equal(row['state'], 'under_review');
  const path = `/v2/agreements/${id}`;
  const first = { requestId: 'term-confirm-0001', version: 1, decision: 'confirm' };
  const confirmed = await call(app, 'POST', `${path}/confirm`, { cookie, body: first });
  assert.equal(confirmed.status, 200);
  assert.deepEqual((await call(app, 'POST', `${path}/confirm`, { cookie, body: first })).body, confirmed.body);
  assert.equal(app.state.agreements.require(id).version, 2);
  const changed = { ...fields, title: '合作者', text: '事件可核实', termTier: 'exact' };
  const edited = await call(app, 'PUT', path, {
    cookie,
    body: { requestId: 'term-propose-0001', version: 2, ...changed },
  });
  assert.equal(edited.status, 200);
  const proposed = json(edited)['agreement'] as Record<string, unknown>;
  assert.equal(proposed['text'], fields.text);
  assert.equal(proposed['termTier'], 'metaphor');
  assert.deepEqual(proposed['proposedTerm'], changed);
  assert.equal(proposed['state'], 'active');
  const stale = await call(app, 'POST', `${path}/confirm`, { cookie,
    body: { requestId: 'term-stale-00001', version: 2, decision: 'confirm' } });
  assert.equal(stale.status, 409);
  const confirmation = { requestId: 'term-confirm-0002', version: 3, decision: 'confirm' };
  const accepted = await call(app, 'POST', `${path}/confirm`, { cookie, body: confirmation });
  assert.equal(accepted.status, 200);
  const active = json(accepted)['agreement'] as Record<string, unknown>;
  assert.equal(active['text'], changed.text);
  assert.equal(active['termTier'], 'exact');
  assert.equal(active['proposedTerm'], null);
  const committed = app.state.agreements.require(id);
  const committedHistory = app.state.agreements.history(id);
  assert.deepEqual((await call(app, 'POST', `${path}/confirm`, { cookie, body: confirmation })).body, accepted.body);
  assert.deepEqual(app.state.agreements.require(id), committed);
  assert.deepEqual(app.state.agreements.history(id), committedHistory);
  const history = app.state.agreements.history(id).at(-1);
  assert.equal(history?.actor, 'user');
  assert.equal(history?.confirmedByDeviceId, app.state.devices.list()[0]!.id);
  assert.equal(history?.reason.includes('签名'), false);
});

test('词条读写需要登录，陌生档位和模型写生效字段被拒绝，解码读取有明确空状态', async () => {
  assert.equal((await call(app, 'POST', '/v2/agreements', { body: {} })).status, 401);
  const invalid = { ...fields, kind: 'term', termTier: 'unknown', requestId: 'term-invalid-001' };
  assert.equal((await call(app, 'POST', '/v2/agreements', { cookie, body: invalid })).status, 400);
  const created = await call(app, 'POST', '/v2/agreements', {
    cookie,
    body: { ...fields, kind: 'term', requestId: 'term-create-0002' },
  });
  const id = String((json(created)['agreement'] as Record<string, unknown>)['id']);
  const response = await call(app, 'GET', `/v2/agreements/${id}/decodings`, { cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(json(response)['decodings'], []);
  const invalidEdit = { requestId: 'term-edit-000003', version: 1, ...fields, state: 'active' };
  assert.equal((await call(app, 'PUT', `/v2/agreements/${id}`, { cookie, body: invalidEdit })).status, 400);
});
