import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('concurrency limit defaults auto, accepts chosen number, rejects invalid, 401 unauth', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/account/work-limit')).status, 401);
  assert.deepEqual(json(await call(t, 'GET', '/v2/account/work-limit', { cookie })), { setting: 'auto', effective: 3 });
  const saved = await call(t, 'PUT', '/v2/account/work-limit', { cookie, body: { setting: 5 } });
  assert.deepEqual(json(saved), { setting: 5, effective: 5 });
  assert.equal(t.app.deps.lines.backgroundLimit(), 5);
  for (const setting of [0, 9, 'many', 2.5]) {
    assert.equal((await call(t, 'PUT', '/v2/account/work-limit', { cookie, body: { setting } })).status, 400);
  }
  const auto = await call(t, 'PUT', '/v2/account/work-limit', { cookie, body: { setting: 'auto' } });
  assert.deepEqual(json(auto), { setting: 'auto', effective: 3 });
});
