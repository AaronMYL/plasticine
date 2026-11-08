import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ROUTES } from '../../src/app/router.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

function samplePath(path: string): string {
  return path.replace(/:[a-z]+/g, 'sample-id');
}

test('除了登录和健康检查，每个接口没有会话都是 401，错误格式带下一步', async () => {
  t = await startTestApp();
  const guarded = ROUTES.filter((route) => route.auth);
  assert.ok(guarded.length >= 14);
  for (const route of guarded) {
    const sent = route.method === 'GET' ? undefined : {};
    const reply = await call(t, route.method, samplePath(route.path), { body: sent });
    assert.equal(reply.status, 401, `${route.method} ${route.path}`);
    const body = json(reply);
    assert.equal(body['code'], 'unauthorized');
    assert.equal(typeof body['error'], 'string');
    assert.equal(typeof body['next'], 'string');
  }
});

test('伪造或撤销的会话也是 401', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: 'plasticine_session=forged' })).status, 401);
});

test('健康检查不要会话', async () => {
  t = await startTestApp();
  const reply = await call(t, 'GET', '/v2/health');
  assert.equal(reply.status, 200);
  assert.equal(json(reply)['ok'], true);
});

test('没有的接口 404，方法不对 405，都用统一的错误格式', async () => {
  t = await startTestApp();
  const missing = await call(t, 'GET', '/v2/nothing');
  assert.equal(missing.status, 404);
  assert.equal(json(missing)['code'], 'not_found');
  const wrong = await call(t, 'PATCH', '/v2/notes');
  assert.equal(wrong.status, 405);
  assert.equal(json(wrong)['code'], 'method_not_allowed');
});

test('请求体不是 JSON 400，Content-Type 不对 415', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const broken = await call(t, 'POST', '/v2/notes', {
    cookie,
    headers: { 'content-type': 'application/json' },
    body: undefined,
  });
  assert.equal(broken.status, 400);
  const form = await fetch(`${t.base}/v2/notes`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'markdown=x',
  });
  assert.equal(form.status, 415);
});
