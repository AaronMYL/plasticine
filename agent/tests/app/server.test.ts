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

test('all endpoints except login and health return 401 without session with next-step error format', async () => {
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

test('forged or revoked session returns 401', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: 'plasticine_session=forged' })).status, 401);
});

test('health check does not require a session', async () => {
  t = await startTestApp();
  const reply = await call(t, 'GET', '/v2/health');
  assert.equal(reply.status, 200);
  assert.equal(json(reply)['ok'], true);
});

test('missing route returns 404 and wrong method returns 405 in unified error format', async () => {
  t = await startTestApp();
  const missing = await call(t, 'GET', '/v2/nothing');
  assert.equal(missing.status, 404);
  assert.equal(json(missing)['code'], 'not_found');
  const wrong = await call(t, 'PATCH', '/v2/notes');
  assert.equal(wrong.status, 405);
  assert.equal(json(wrong)['code'], 'method_not_allowed');
});

test('non-JSON body returns 400; wrong Content-Type returns 415', async () => {
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
