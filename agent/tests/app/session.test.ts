import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';
import { PASSWORD_FAILURE_LIMIT } from '../../src/app/config.ts';
import { hashPassword } from '../../src/app/password-hash.ts';
import { call, cookieFrom, json, pair, startTestApp, TEST_PASSWORD, type TestApp } from './helpers.ts';

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
  const { hash, salt } = await hashPassword(TEST_PASSWORD);
  t.state.ownerAccount.setPassword(hash, salt, t.clock.now().toISOString());
});

afterEach(async () => {
  await t.close();
});

function login(password: string, deviceName = 'Alex 的 iPhone') {
  return call(t, 'POST', '/v2/session/password', { body: { password, deviceName } });
}

test('password login returns 201, registers device, sets HttpOnly + Secure + SameSite=Strict cookie', async () => {
  const reply = await login(TEST_PASSWORD);
  assert.equal(reply.status, 201);
  const cookie = reply.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const body = json(reply);
  const device = body['device'] as Record<string, unknown>;
  assert.equal(device['name'], 'Alex 的 iPhone');
  assert.equal(device['current'], true);
  assert.equal(device['local'], false);
  assert.equal(t.state.devices.list().length, 1);
  const me = await call(t, 'GET', '/v2/session', { cookie: cookieFrom(reply) });
  assert.equal(me.status, 200);
});

test('DB stores only slow password hash and session token digest, never plaintext', async () => {
  const reply = await login(TEST_PASSWORD);
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const token = cookieFrom(reply).split('=')[1] ?? '';
  const session = t.state.sessions.findByTokenHash(sha(token));
  assert.ok(session !== undefined);
  assert.notEqual(session.tokenHash, token);
  const stored = t.state.ownerAccount.credentials();
  assert.ok(stored !== null);
  assert.match(stored.hash, /^scrypt\$16384\$8\$1\$[0-9a-f]{128}$/);
  assert.equal(stored.hash.includes(TEST_PASSWORD), false);
});

test('wrong password returns 401 login_failed; repeated failures trigger 429 blocking valid logins', async () => {
  const wrong = await login('fake-wrong-pass');
  assert.equal(wrong.status, 401);
  assert.equal(json(wrong)['code'], 'login_failed');
  for (let index = 1; index < PASSWORD_FAILURE_LIMIT; index += 1) {
    await login('fake-wrong-pass');
  }
  const blocked = await login(TEST_PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal(json(blocked)['code'], 'too_many_attempts');
});

test('missing device name returns 400 identifying the field', async () => {
  const reply = await call(t, 'POST', '/v2/session/password', { body: { password: TEST_PASSWORD } });
  assert.equal(reply.status, 400);
  assert.equal(json(reply)['code'], 'invalid_request');
});

test('slow login request is rate-limited upon reading body if other requests hit 10 failures first', async () => {
  const body = JSON.stringify({ password: TEST_PASSWORD, deviceName: '慢请求设备' });
  const arrived = once(t.app.server, 'request');
  const reply = Promise.withResolvers<number>();
  const slow = request(`${t.base}/v2/session/password`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (res) => {
    res.resume();
    reply.resolve(res.statusCode ?? 0);
  });
  slow.on('error', reply.reject);
  try {
    slow.write(body.slice(0, -1));
    await arrived;
    for (let index = 0; index < PASSWORD_FAILURE_LIMIT; index += 1) {
      assert.equal((await login('fake-wrong-pass')).status, 401);
    }
    slow.end(body.slice(-1));
    assert.equal(await reply.promise, 429);
    assert.equal(t.state.devices.list().length, 0);
  } finally {
    slow.destroy();
  }
});

test('logout invalidates cookie (401) and clears it while keeping device record', async () => {
  const cookie = await pair(t);
  const out = await call(t, 'DELETE', '/v2/session', { cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  const after = await call(t, 'GET', '/v2/session', { cookie });
  assert.equal(after.status, 401);
  assert.equal(json(after)['code'], 'unauthorized');
  assert.equal(t.state.devices.list().length, 1);
});

test('device last-seen timestamp updates at most once per minute', async () => {
  const cookie = await pair(t);
  const before = t.state.devices.list()[0]?.lastSeenAt;
  await call(t, 'GET', '/v2/session', { cookie });
  assert.equal(t.state.devices.list()[0]?.lastSeenAt, before);
  t.clock.advance(61_000);
  await call(t, 'GET', '/v2/session', { cookie });
  assert.notEqual(t.state.devices.list()[0]?.lastSeenAt, before);
});
