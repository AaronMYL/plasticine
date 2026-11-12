// 设置 · AI「同时做几件事」：读、改；改了马上生效（调大了排着队的接着开跑）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('同时做几件事：默认自动；选了数就按选的；不认识的值拒；没登录 401', async () => {
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
