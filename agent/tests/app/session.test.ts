import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';
import { PAIRING_REPLAY_WINDOW_MS, REPLAYED_HEADER } from '../../shared/api/index.ts';
import { PAIRING_CODE_TTL_MS, PAIRING_FAILURE_LIMIT } from '../../src/app/config.ts';
import { issuePairingCode, normalizePairingCode } from '../../src/app/pairing-code.ts';
import { call, cookieFrom, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;

beforeEach(async () => {
  t = await startTestApp();
});

afterEach(async () => {
  await t.close();
});

function exchange(code: string, deviceName = 'Alex 的 iPhone') {
  return call(t, 'POST', '/v2/session', { body: { code, deviceName } });
}

function exchangeWithId(code: string, requestId: string, deviceName = 'Alex 的 iPhone') {
  return call(t, 'POST', '/v2/session', { body: { code, deviceName, requestId } });
}

test('配对码换到会话：201、登记设备、cookie 是 HttpOnly + Secure + SameSite=Strict', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const reply = await exchange(code);
  assert.equal(reply.status, 201);
  const cookie = reply.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const body = json(reply);
  const device = body['device'] as Record<string, unknown>;
  assert.equal(device['name'], 'Alex 的 iPhone');
  assert.equal(device['current'], true);
  assert.equal(t.state.devices.list().length, 1);
  const me = await call(t, 'GET', '/v2/session', { cookie: cookieFrom(reply) });
  assert.equal(me.status, 200);
});

test('配对码只能用一次：第二次 401 pairing_code_used，不再登记设备', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  assert.equal((await exchange(code)).status, 201);
  const again = await exchange(code, '另一台');
  assert.equal(again.status, 401);
  assert.equal(json(again)['code'], 'pairing_code_used');
  assert.equal(t.state.devices.list().length, 1);
});

test('回执丢了用同一 requestId 和同一个码重发：给同一台设备再发一个新会话，不登记第二台', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const first = await exchangeWithId(code, 'req_pair_0001');
  assert.equal(first.status, 201);
  const again = await exchangeWithId(code, 'req_pair_0001', '重发时换了名字');
  assert.equal(again.status, 201);
  assert.equal(again.headers.get(REPLAYED_HEADER), '1');
  assert.equal(t.state.devices.list().length, 1);
  const firstDevice = json(first)['device'] as Record<string, unknown>;
  const againDevice = json(again)['device'] as Record<string, unknown>;
  assert.equal(againDevice['id'], firstDevice['id']);
  assert.equal(againDevice['name'], 'Alex 的 iPhone');
  assert.notEqual(cookieFrom(again), cookieFrom(first));
  const me = await call(t, 'GET', '/v2/session', { cookie: cookieFrom(again) });
  assert.equal(me.status, 200);
});

test('同一个码换了 requestId 再来：照旧 401 pairing_code_used', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  assert.equal((await exchangeWithId(code, 'req_pair_0001')).status, 201);
  const other = await exchangeWithId(code, 'req_pair_0002');
  assert.equal(other.status, 401);
  assert.equal(json(other)['code'], 'pairing_code_used');
  assert.equal(t.state.devices.list().length, 1);
});

test('同一 requestId 拿来配另一个码：409 request_id_reused，不登记设备', async () => {
  const first = issuePairingCode(t.state, t.clock.now());
  assert.equal((await exchangeWithId(first.code, 'req_pair_0001')).status, 201);
  const second = issuePairingCode(t.state, t.clock.now());
  const reply = await exchangeWithId(second.code, 'req_pair_0001');
  assert.equal(reply.status, 409);
  assert.equal(json(reply)['code'], 'request_id_reused');
  assert.equal(t.state.devices.list().length, 1);
});

test('超过 10 分钟再重放：不再认作同一次配对，401 pairing_code_used', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  assert.equal((await exchangeWithId(code, 'req_pair_0001')).status, 201);
  t.clock.advance(PAIRING_REPLAY_WINDOW_MS + 1);
  const late = await exchangeWithId(code, 'req_pair_0001');
  assert.equal(late.status, 401);
  assert.equal(json(late)['code'], 'pairing_code_used');
  assert.equal(t.state.devices.list().length, 1);
});

test('那台设备撤销之后重放：不发会话', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const first = await exchangeWithId(code, 'req_pair_0001');
  const device = json(first)['device'] as Record<string, unknown>;
  const revoked = await call(t, 'DELETE', `/v2/devices/${String(device['id'])}`, { cookie: cookieFrom(first) });
  assert.equal(revoked.status, 200);
  const again = await exchangeWithId(code, 'req_pair_0001');
  assert.equal(again.status, 401);
  assert.equal(again.headers.get('set-cookie'), null);
});

test('别的操作用过的 requestId 拿来配对：409 request_id_reused', async () => {
  const cookie = await pair(t);
  const created = await call(t, 'POST', '/v2/notes', { cookie, body: { requestId: 'req_shared_01', markdown: '' } });
  assert.equal(created.status, 201);
  const { code } = issuePairingCode(t.state, t.clock.now());
  const reply = await exchangeWithId(code, 'req_shared_01');
  assert.equal(reply.status, 409);
  assert.equal(json(reply)['code'], 'request_id_reused');
  assert.equal(t.state.devices.list().length, 1);
});

test('配对码 10 分钟后过期：401 pairing_code_expired', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  t.clock.advance(PAIRING_CODE_TTL_MS + 1);
  const reply = await exchange(code);
  assert.equal(reply.status, 401);
  assert.equal(json(reply)['code'], 'pairing_code_expired');
  assert.equal(json(reply)['field'], 'code');
});

test('库里只存配对码和会话令牌的散列，不存原文', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const reply = await exchange(code);
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const stored = t.state.pairingCodes.findByHash(sha(normalizePairingCode(code)));
  assert.ok(stored !== undefined);
  assert.notEqual(stored.codeHash, code);
  const token = cookieFrom(reply).split('=')[1] ?? '';
  const session = t.state.sessions.findByTokenHash(sha(token));
  assert.ok(session !== undefined);
  assert.notEqual(session.tokenHash, token);
});

test('输入时大小写、空格、横线都不要紧', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const sloppy = ` ${code.toLowerCase().replace('-', ' ')} `;
  assert.equal((await exchange(sloppy)).status, 201);
});

test('错码 401 pairing_code_invalid；连续错太多次 429，对的码这时也先不收', async () => {
  const wrong = await exchange('0000-0000');
  assert.equal(wrong.status, 401);
  assert.equal(json(wrong)['code'], 'pairing_code_invalid');
  for (let index = 1; index < PAIRING_FAILURE_LIMIT; index += 1) {
    await exchange('0000-0000');
  }
  const { code } = issuePairingCode(t.state, t.clock.now());
  const blocked = await exchange(code);
  assert.equal(blocked.status, 429);
  assert.equal(json(blocked)['code'], 'too_many_attempts');
});

test('设备名缺了 400 并说是哪个字段', async () => {
  const reply = await call(t, 'POST', '/v2/session', { body: { code: 'ABCD-EFGH' } });
  assert.equal(reply.status, 400);
  assert.equal(json(reply)['code'], 'invalid_request');
});

test('慢请求开始后别的请求已错满十次，慢请求读完正文时也必须受限', async () => {
  const { code } = issuePairingCode(t.state, t.clock.now());
  const body = JSON.stringify({ code, deviceName: '慢请求设备' });
  const arrived = once(t.app.server, 'request');
  const reply = Promise.withResolvers<number>();
  const slow = request(`${t.base}/v2/session`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (res) => {
    res.resume();
    reply.resolve(res.statusCode ?? 0);
  });
  slow.on('error', reply.reject);
  try {
    slow.write(body.slice(0, -1));
    await arrived;
    for (let index = 0; index < PAIRING_FAILURE_LIMIT; index += 1) {
      assert.equal((await exchange('0000-0000')).status, 401);
    }
    slow.end(body.slice(-1));
    assert.equal(await reply.promise, 429);
    assert.equal(t.state.devices.list().length, 0);
  } finally {
    slow.destroy();
  }
});

test('登出后同一个 cookie 401，cookie 被清掉；设备还在', async () => {
  const cookie = await pair(t);
  const out = await call(t, 'DELETE', '/v2/session', { cookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  const after = await call(t, 'GET', '/v2/session', { cookie });
  assert.equal(after.status, 401);
  assert.equal(json(after)['code'], 'unauthorized');
  assert.equal(t.state.devices.list().length, 1);
});

test('最后时间最多一分钟写一次', async () => {
  const cookie = await pair(t);
  const before = t.state.devices.list()[0]?.lastSeenAt;
  await call(t, 'GET', '/v2/session', { cookie });
  assert.equal(t.state.devices.list()[0]?.lastSeenAt, before);
  t.clock.advance(61_000);
  await call(t, 'GET', '/v2/session', { cookie });
  assert.notEqual(t.state.devices.list()[0]?.lastSeenAt, before);
});
