import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('时区设置往返且能清空；请求没带 tz 才用上海，带了按客户端时区分日', async () => {
  t = await startTestApp();
  t.clock.advance(Date.parse('2026-10-27T01:00:00Z') - t.clock.now().getTime());
  const cookie = await pair(t);
  const saved = await call(t, 'PUT', '/v2/today/settings', { cookie, body: {
    requestId: newRequestId('tz'), version: 0, timeZone: 'America/Los_Angeles',
  } });
  assert.equal(saved.status, 200);
  assert.equal(json(await call(t, 'GET', '/v2/today/settings', { cookie }))['timeZone'], 'America/Los_Angeles');
  const missing = json(await call(t, 'GET', '/v2/home', { cookie }));
  const explicit = json(await call(t, 'GET', '/v2/home?tz=America/Los_Angeles', { cookie }));
  assert.equal(missing['timeZone'], 'Asia/Shanghai');
  assert.equal(explicit['timeZone'], 'America/Los_Angeles');
  assert.notEqual(explicit['date'], missing['date']);
  const invalid = await call(t, 'PUT', '/v2/today/settings', { cookie, body: {
    requestId: newRequestId('tz'), version: 1, timeZone: 'Mars/Base',
  } });
  assert.equal(invalid.status, 400);
  const cleared = await call(t, 'PUT', '/v2/today/settings', { cookie, body: {
    requestId: newRequestId('tz'), version: 1, timeZone: null,
  } });
  assert.equal(cleared.status, 200);
  assert.equal(json(cleared)['timeZone'], null);
});

test('原来的 GET /v2/today 没有了（首页取代）；首页没登录是 401；时区写错是 400 指明 tz', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/home')).status, 401);
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/today', { cookie })).status, 404);
  const bad = await call(t, 'GET', '/v2/home?tz=Mars/Base', { cookie });
  assert.equal(bad.status, 400);
  assert.equal(json(bad)['field'], 'tz');
});

test('首页：钉住层只放等你的卡，今天的数跟着记账走', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const { desk } = t.app.deps;
  desk.commit((changes) => desk.raise(changes, { kind: 'decide', purpose: 'line_question', question: '要不要买？',
    options: [{ id: 'y', label: '买', recommended: true }, { id: 'n', label: '不买' }], runId: 'line:line-main' }));
  const home = json(await call(t, 'GET', '/v2/home', { cookie }));
  assert.equal((home['pinned'] as unknown[]).length, 1);
});

test('每日设置：读默认、带版本改；过时的版本 409', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const initial = json(await call(t, 'GET', '/v2/today/settings', { cookie }));
  assert.equal(initial['briefLimit'], 20);
  assert.equal(initial['returnThresholdHours'], 4);
  const body = { requestId: newRequestId('set'), version: 0, returnThresholdHours: 1 };
  const saved = await call(t, 'PUT', '/v2/today/settings', { cookie, body });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const stale = await call(t, 'PUT', '/v2/today/settings', {
    cookie,
    body: { requestId: newRequestId('set'), version: 0, briefLimit: 5 },
  });
  assert.equal(stale.status, 409);
});
