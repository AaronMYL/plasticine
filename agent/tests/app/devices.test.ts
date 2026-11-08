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

test('列出登记过的设备，标出当前这台', async () => {
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

test('撤销另一台：它的会话立刻 401，列表里留着撤销时间', async () => {
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

test('撤销自己这台：同时清掉 cookie', async () => {
  const phone = await pair(t, '手机');
  const id = t.state.devices.list()[0]?.id ?? '';
  const reply = await call(t, 'DELETE', `/v2/devices/${id}`, { cookie: phone });
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await call(t, 'GET', '/v2/devices', { cookie: phone })).status, 401);
});

test('撤销不存在的设备 404', async () => {
  const cookie = await pair(t);
  const reply = await call(t, 'DELETE', '/v2/devices/nope', { cookie });
  assert.equal(reply.status, 404);
  assert.equal(json(reply)['code'], 'not_found');
});

test('已配对浏览器生成一次性码，新浏览器能配对且旧码不能重复使用', async () => {
  const cookie = await pair(t);
  const issued = await call(t, 'POST', '/v2/devices/pairing-codes', { cookie });
  assert.equal(issued.status, 201);
  const code = json(issued)['code'];
  assert.equal(typeof json(issued)['expiresAt'], 'string');
  const first = await call(t, 'POST', '/v2/session', { body: { code, deviceName: '新浏览器' } });
  assert.equal(first.status, 201);
  assert.equal((await call(t, 'POST', '/v2/session', { body: { code, deviceName: '重复浏览器' } })).status, 401);
  assert.equal(t.state.devices.list().length, 2);
});

test('邀请状态须登录，只在这一个配对码被使用后返回那台新设备，不回传码或散列', async () => {
  const cookie = await pair(t);
  const issued = json(await call(t, 'POST', '/v2/devices/pairing-codes', { cookie }));
  assert.equal(typeof issued['id'], 'string');
  assert.match(String(issued['code']), /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const path = `/v2/devices/pairing-codes/${String(issued['id'])}`;
  assert.equal((await call(t, 'GET', path)).status, 401);
  const waiting = json(await call(t, 'GET', path, { cookie }));
  assert.equal(waiting['status'], 'waiting');
  assert.equal(waiting['device'], null);
  assert.equal('code' in waiting, false);
  assert.equal('codeHash' in waiting, false);
  await pair(t, '另一份邀请来的设备');
  assert.equal(json(await call(t, 'GET', path, { cookie }))['status'], 'waiting');
  const connected = json(await call(t, 'POST', '/v2/session', {
    body: { code: issued['code'], deviceName: '这次邀请的手机', requestId: 'req_invite_phone_1' },
  }));
  const status = json(await call(t, 'GET', path, { cookie }));
  assert.equal(status['status'], 'connected');
  assert.equal((status['device'] as Record<string, unknown>)['id'],
    (connected['device'] as Record<string, unknown>)['id']);
  assert.equal((status['device'] as Record<string, unknown>)['current'], false);
  t.clock.advance(11 * 60 * 1000);
  assert.equal(json(await call(t, 'GET', path, { cookie }))['status'], 'connected');
  const device = status['device'] as Record<string, unknown>;
  await call(t, 'DELETE', `/v2/devices/${String(device['id'])}`, { cookie });
  assert.equal(json(await call(t, 'GET', path, { cookie }))['status'], 'revoked');
});

test('未使用的邀请按服务端时钟过期；不存在的邀请 404', async () => {
  const cookie = await pair(t);
  const issued = json(await call(t, 'POST', '/v2/devices/pairing-codes', { cookie }));
  assert.ok(Math.abs(Date.parse(String(issued['issuedAt'])) - t.clock.now().getTime()) < 1000);
  t.clock.advance(10 * 60 * 1000);
  const status = json(await call(t, 'GET', `/v2/devices/pairing-codes/${String(issued['id'])}`, { cookie }));
  assert.equal(status['status'], 'expired');
  assert.equal(status['device'], null);
  assert.ok(Math.abs(Date.parse(String(status['checkedAt'])) - t.clock.now().getTime()) < 1000);
  assert.equal((await call(t, 'GET', '/v2/devices/pairing-codes/missing', { cookie })).status, 404);
});
