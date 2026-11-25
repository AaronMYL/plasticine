import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { LOCAL_TOKEN_HEADER, SETUP_TOKEN_TTL_MS } from '../../shared/api/account.ts';
import { openSession } from '../../src/app/auth.ts';
import { PASSWORD_FAILURE_LIMIT, PASSWORD_GLOBAL_FAILURE_LIMIT } from '../../src/app/config.ts';
import { fromLoopback, localTokenValid, requestSource } from '../../src/app/local-access.ts';
import { issueSetupToken } from '../../src/app/setup-link.ts';
import { call, cookieFrom, json, pair, startTestApp, TEST_PASSWORD, type TestApp, type TestAppOptions }
  from './helpers.ts';

const LOCAL_TOKEN = 'fake-local-token-for-tests';
const PASSWORD = 'fake-password-123';
const open: TestApp[] = [];

async function app(options: TestAppOptions = {}): Promise<TestApp> {
  const started = await startTestApp([], { localToken: LOCAL_TOKEN, ...options });
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const local = { [LOCAL_TOKEN_HEADER]: LOCAL_TOKEN };
const setupBody = (extra: Record<string, unknown> = {}) => ({ displayName: '测试名', handle: null, password: PASSWORD,
  deviceName: '测试电脑', ...extra });

async function setUp(t: TestApp, extra: Record<string, unknown> = {}): Promise<string> {
  const reply = await call(t, 'POST', '/v2/account/setup', { body: setupBody(extra), headers: local });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return cookieFrom(reply);
}

async function accountState(t: TestApp): Promise<Record<string, unknown>> {
  return json(await call(t, 'GET', '/v2/account/state'));
}

test('new instance: account status is needed; name, handle, and URL are empty', async () => {
  const t = await app();
  assert.deepEqual(await accountState(t), { setup: 'needed', handle: null, displayName: null, passwordSet: false,
    networkUrl: null });
});

test('legacy instance (logged-in device, no password): done + passwordSet false; devices still work', async () => {
  const t = await app();
  const at = t.clock.now();
  const device = t.state.devices.create({ name: '老手机', firstSeenAt: at.toISOString(), lastSeenAt: at.toISOString() });
  const opened = openSession({ state: t.state }, device, at);
  const cookie = opened.cookie.split(';')[0] ?? '';
  assert.deepEqual(await accountState(t), { setup: 'done', handle: null, displayName: null, passwordSet: false,
    networkUrl: null });
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 200);
  const blocked = await call(t, 'POST', '/v2/account/setup', { body: setupBody(), headers: local });
  assert.equal(blocked.status, 409);
  assert.equal(json(blocked)['code'], 'already_set_up');
  const set = await call(t, 'PUT', '/v2/account/password', { cookie, body: { password: PASSWORD } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await accountState(t))['passwordSet'], true);
});

test('setup with local token: 201 + session cookie, local device, done, welcome with 3 start prompts', async () => {
  const t = await app();
  const reply = await call(t, 'POST', '/v2/account/setup', { body: setupBody(), headers: local });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const cookie = cookieFrom(reply);
  const body = json(reply);
  assert.deepEqual(body['network'], { joined: false, url: null, problem: null });
  assert.equal((body['session'] as { device: { name: string; local: boolean } }).device.local, true);
  assert.deepEqual(await accountState(t), { setup: 'done', handle: null, displayName: '测试名', passwordSet: true,
    networkUrl: null });
  const devices = json(await call(t, 'GET', '/v2/devices', { cookie }))['devices'] as { local?: boolean }[];
  assert.deepEqual(devices.map((device) => device.local), [true]);
  const main = t.app.deps.lines.read('main', 50);
  const welcome = main.messages.at(-1);
  assert.equal(welcome?.role, 'welcome');
  assert.match(welcome?.text ?? '', /测试名/);
  assert.deepEqual(welcome?.starts?.map((start) => start.label), ['导入我的笔记', '订几个信息源', '先聊聊，认识一下']);
  assert.equal(main.line.status, 'idle', '欢迎不开一轮');
});

test('account setup runs once: second attempt returns 409; password never stored in plaintext', async () => {
  const t = await app();
  await setUp(t);
  const again = await call(t, 'POST', '/v2/account/setup', { body: setupBody(), headers: local });
  assert.equal(again.status, 409);
  for (const file of ['plasticine.sqlite', 'plasticine.sqlite-wal']) {
    const bytes = await readFile(join(t.directory, file)).catch(() => Buffer.alloc(0));
    assert.equal(bytes.includes(Buffer.from(PASSWORD)), false, file);
  }
});

test('setup requires auth: missing/bad token, unset local token, or forwarded request returns 403', async () => {
  const t = await app();
  const none = await call(t, 'POST', '/v2/account/setup', { body: setupBody() });
  assert.equal(none.status, 403);
  const wrong = await call(t, 'POST', '/v2/account/setup', { body: setupBody(),
    headers: { [LOCAL_TOKEN_HEADER]: 'fake-wrong-token' } });
  assert.equal(wrong.status, 403);
  const forwarded = await call(t, 'POST', '/v2/account/setup', { body: setupBody(),
    headers: { ...local, 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(forwarded.status, 403);
  assert.equal((await accountState(t))['setup'], 'needed');
  const unset = await app({ localToken: '' });
  assert.equal((await call(unset, 'POST', '/v2/account/setup', { body: setupBody(), headers: local })).status, 403);
});

test('local token accepts only direct 127.0.0.1: rejects other IPs, forwarded headers, or unset token', () => {
  const request = (remoteAddress: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress }, headers }) as unknown as Parameters<typeof fromLoopback>[0];
  assert.equal(fromLoopback(request('127.0.0.1')), true);
  assert.equal(fromLoopback(request('::ffff:127.0.0.1')), true);
  assert.equal(fromLoopback(request('192.168.1.20')), false);
  assert.equal(fromLoopback(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })), false);
  assert.equal(fromLoopback(request('127.0.0.1', { forwarded: 'for=203.0.113.7' })), false);
  const withToken = (remote: string) => request(remote, { [LOCAL_TOKEN_HEADER]: LOCAL_TOKEN });
  assert.equal(localTokenValid(LOCAL_TOKEN, withToken('127.0.0.1')), true);
  assert.equal(localTokenValid(LOCAL_TOKEN, withToken('10.0.0.3')), false);
  assert.equal(localTokenValid(null, withToken('127.0.0.1')), false);
  assert.equal(localTokenValid('', request('127.0.0.1', { [LOCAL_TOKEN_HEADER]: '' })), false);
  assert.equal(requestSource(request('127.0.0.1', { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' })),
    '203.0.113.7');
  assert.equal(requestSource(request('192.168.1.20', { 'x-forwarded-for': '203.0.113.7' })), '192.168.1.20');
});

test('one-time setup link: 30m TTL, single-use; bad/expired returns 401; not issued if owner exists', async () => {
  const t = await app();
  const issued = issueSetupToken(t.state, t.clock.now());
  assert.ok(issued !== null);
  assert.match(issued.token, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const wrong = await call(t, 'POST', '/v2/account/setup', { body: setupBody({ setupToken: 'FAKE-FAKE-FAKE' }) });
  assert.equal(wrong.status, 401);
  assert.equal(json(wrong)['code'], 'setup_token_invalid');
  t.clock.advance(SETUP_TOKEN_TTL_MS);
  const late = await call(t, 'POST', '/v2/account/setup', { body: setupBody({ setupToken: issued.token }) });
  assert.equal(late.status, 401);
  const fresh = issueSetupToken(t.state, t.clock.now());
  assert.ok(fresh !== null);
  const done = await call(t, 'POST', '/v2/account/setup', { body: setupBody({ setupToken: fresh.token }) });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(json(done)['session'] !== undefined, true);
  const twice = await call(t, 'POST', '/v2/account/setup', { body: setupBody({ setupToken: fresh.token }) });
  assert.equal(twice.status, 409);
  assert.equal(issueSetupToken(t.state, t.clock.now()), null);
});

test('password login: 201 registers device/session; wrong returns 401 without naming bad field', async () => {
  const t = await app();
  await setUp(t);
  const ok = await call(t, 'POST', '/v2/session/password', { body: { password: PASSWORD, deviceName: '手机' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const cookie = cookieFrom(ok);
  assert.equal(json(await call(t, 'GET', '/v2/session', { cookie }))['device'] !== undefined, true);
  const wrong = await call(t, 'POST', '/v2/session/password',
    { body: { password: 'fake-wrong-pass', deviceName: '手机' } });
  assert.equal(wrong.status, 401);
  assert.equal(json(wrong)['code'], 'login_failed');
  assert.equal(json(wrong)['error'], '账号或密码不对。');
});

test('password login before account setup: returns 409 setup_needed', async () => {
  const t = await app();
  const reply = await call(t, 'POST', '/v2/session/password', { body: { password: PASSWORD, deviceName: '手机' } });
  assert.equal(reply.status, 409);
  assert.equal(json(reply)['code'], 'setup_needed');
});

test('password login rate limit: 429 per source after failures; other sources unaffected; global cap', async () => {
  const t = await app();
  await setUp(t);
  const from = (address: string) => ({ 'x-forwarded-for': address });
  const attempt = (address: string, password: string) => call(t, 'POST', '/v2/session/password',
    { body: { password, deviceName: '手机' }, headers: from(address) });
  for (let index = 0; index < PASSWORD_FAILURE_LIMIT; index += 1) {
    assert.equal((await attempt('203.0.113.1', 'fake-wrong-pass')).status, 401);
  }
  const blocked = await attempt('203.0.113.1', PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal(json(blocked)['code'], 'too_many_attempts');
  assert.equal((await attempt('203.0.113.2', PASSWORD)).status, 201);
  let failures = PASSWORD_FAILURE_LIMIT;
  for (let source = 3; failures < PASSWORD_GLOBAL_FAILURE_LIMIT; source += 1) {
    for (let index = 0; index < PASSWORD_FAILURE_LIMIT - 1 && failures < PASSWORD_GLOBAL_FAILURE_LIMIT; index += 1) {
      assert.equal((await attempt(`203.0.113.${source}`, 'fake-wrong-pass')).status, 401);
      failures += 1;
    }
  }
  assert.equal((await attempt('198.51.100.9', PASSWORD)).status, 429, '全局上限');
});

test('local login: token + 127.0.0.1 reuses local device; rejects missing token, proxy, no setup', async () => {
  const fresh = await app();
  const early = await call(fresh, 'POST', '/v2/session/local', { body: { deviceName: '这台电脑' }, headers: local });
  assert.equal(early.status, 409);
  const t = await app();
  await setUp(t);
  const first = await call(t, 'POST', '/v2/session/local', { body: { deviceName: '这台电脑' }, headers: local });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await call(t, 'POST', '/v2/session/local', { body: { deviceName: '这台电脑' }, headers: local });
  const deviceOf = (reply: Awaited<ReturnType<typeof call>>) =>
    (json(reply)['device'] as { id: string; local: boolean });
  assert.equal(deviceOf(first).local, true);
  assert.equal(deviceOf(second).id, deviceOf(first).id);
  const current = json(await call(t, 'GET', '/v2/session', { cookie: cookieFrom(first) }))['device'];
  assert.equal(deviceOf(first).id, (current as { id: string }).id);
  assert.equal((await call(t, 'POST', '/v2/session/local', { body: { deviceName: '这台电脑' } })).status, 403);
  const forwarded = await call(t, 'POST', '/v2/session/local', { body: { deviceName: '这台电脑' },
    headers: { ...local, 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(forwarded.status, 403);
});

test('change password: needs old password if set (401 wrong); updates so only new password works', async () => {
  const t = await app();
  await setUp(t);
  const phone = await call(t, 'POST', '/v2/session/password', { body: { password: PASSWORD, deviceName: '手机' } });
  const cookie = cookieFrom(phone);
  const missing = await call(t, 'PUT', '/v2/account/password', { cookie, body: { password: 'fake-new-pass-1' } });
  assert.equal(missing.status, 400);
  assert.equal(json(missing)['field'], 'current');
  const wrong = await call(t, 'PUT', '/v2/account/password', { cookie,
    body: { current: 'fake-wrong-pass', password: 'fake-new-pass-1' } });
  assert.equal(wrong.status, 401);
  const done = await call(t, 'PUT', '/v2/account/password', { cookie,
    body: { current: PASSWORD, password: 'fake-new-pass-1' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(typeof json(done)['passwordSetAt'], 'string');
  const login = (password: string) => call(t, 'POST', '/v2/session/password', { body: { password, deviceName: '平板' } });
  assert.equal((await login(PASSWORD)).status, 401);
  assert.equal((await login('fake-new-pass-1')).status, 201);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 200, '别的设备的会话照旧');
});

test('change password skips old password with local token header or local device from 127.0.0.1', async () => {
  const t = await app();
  const cookie = await setUp(t);
  const viaLocalDevice = await call(t, 'PUT', '/v2/account/password',
    { cookie, body: { password: 'fake-new-pass-2' } });
  assert.equal(viaLocalDevice.status, 200, JSON.stringify(viaLocalDevice.body));
  const phone = cookieFrom(await call(t, 'POST', '/v2/session/password',
    { body: { password: 'fake-new-pass-2', deviceName: '手机' } }));
  const viaToken = await call(t, 'PUT', '/v2/account/password', { cookie: phone, headers: local,
    body: { password: 'fake-new-pass-3' } });
  assert.equal(viaToken.status, 200, JSON.stringify(viaToken.body));
  const viaPhone = await call(t, 'PUT', '/v2/account/password',
    { cookie: phone, body: { password: 'fake-new-pass-4' } });
  assert.equal(viaPhone.status, 400, '手机上改要旧密码');
});

test('pairing-code login removed: POST /v2/session and pairing-codes gone; session/device APIs work', async () => {
  const t = await app();
  const cookie = await pair(t);
  assert.equal((await call(t, 'POST', '/v2/session', { body: { code: 'ABCD-EFGH', deviceName: '手机' } })).status, 405);
  assert.equal((await call(t, 'POST', '/v2/devices/pairing-codes', { cookie })).status, 405);
  assert.equal((await call(t, 'GET', '/v2/devices/pairing-codes/whatever', { cookie })).status, 404);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 200);
  assert.equal((await call(t, 'GET', '/v2/devices', { cookie })).status, 200);
  assert.equal(TEST_PASSWORD.startsWith('fake-'), true);
});
