import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.close();
});

test('lists registered devices and marks the current device', async () => {
  await pair(t, '手机');
  const laptop = await pair(t, '电脑');
  const reply = await call(t, 'GET', '/v2/devices', { cookie: laptop });
  assert.equal(reply.status, 200);
  const devices = json(reply)['devices'] as Record<string, unknown>[];
  assert.deepEqual(
    devices.map((device) => [device['name'], device['current']]),
    [
      ['电脑', true],
      ['手机', false],
    ],
  );
});

test('revoking another device invalidates its session (401) and records revoked timestamp', async () => {
  const phone = await pair(t, '手机');
  const laptop = await pair(t, '电脑');
  const phoneId = t.state.devices.list().find((device) => device.name === '手机')?.id ?? '';
  const reply = await call(t, 'DELETE', `/v2/devices/${phoneId}`, { cookie: laptop });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('set-cookie'), null);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: phone })).status, 401);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: laptop })).status, 200);
  const revoked = t.state.devices.get(phoneId);
  assert.notEqual(revoked?.revokedAt, null);
});

test('revoking current device also clears session cookie', async () => {
  const phone = await pair(t, '手机');
  const id = t.state.devices.list()[0]?.id ?? '';
  const reply = await call(t, 'DELETE', `/v2/devices/${id}`, { cookie: phone });
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await call(t, 'GET', '/v2/devices', { cookie: phone })).status, 401);
});

test('revoking nonexistent device returns 404', async () => {
  const cookie = await pair(t);
  const reply = await call(t, 'DELETE', '/v2/devices/nope', { cookie });
  assert.equal(reply.status, 404);
  assert.equal(json(reply)['code'], 'not_found');
});
