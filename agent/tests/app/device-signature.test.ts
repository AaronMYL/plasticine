import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEVICE_KEY_REGISTRATION_WINDOW_MS,
  DEVICE_KEYS_PATH,
  REPLAYED_HEADER,
} from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey, signedCall, type TestDeviceKey } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

// 旧钥匙登记接口保留兼容与历史；业务确认的会话规则见 user-confirmation.test.ts。
const PATH = '/v2/tool-groups/inbox';

interface Setup {
  t: TestApp;
  cookie: string;
  key: TestDeviceKey;
}

async function setup(register = true): Promise<Setup> {
  t = await startTestApp();
  const cookie = await pair(t);
  const key = newDeviceKey();
  if (register) {
    assert.equal((await registerKey(t, cookie, key)).status, 201);
  }
  return { t, cookie, key };
}

function toggle(s: Setup, enabled = false, requestId = newRequestId()) {
  return { requestId, version: s.t.state.toolGroups.get('inbox')?.version ?? 0, enabled };
}

test('登记设备钥匙：201，查得到这台设备的钥匙；同一请求重发得到同一回答', async () => {
  const s = await setup(false);
  const body = { requestId: newRequestId('key'), publicKey: { ...s.key.publicJwk, ext: true, key_ops: ['verify'] } };
  const first = await call(s.t, 'POST', DEVICE_KEYS_PATH, { cookie: s.cookie, body });
  assert.equal(first.status, 201);
  const again = await call(s.t, 'POST', DEVICE_KEYS_PATH, { cookie: s.cookie, body });
  assert.equal(again.headers.get(REPLAYED_HEADER), '1');
  assert.deepEqual(again.body, first.body);
  const current = json(await call(s.t, 'GET', DEVICE_KEYS_PATH, { cookie: s.cookie }));
  const key = current['key'] as Record<string, unknown>;
  assert.equal(key['id'], (json(first)['key'] as Record<string, unknown>)['id']);
  const stored = s.t.state.deviceKeys.liveFor(String(key['deviceId']));
  assert.deepEqual(Object.keys(stored?.publicKey ?? {}).sort(), ['crv', 'kty', 'x', 'y']);
});

test('登记钥匙防重放：同一 requestId 换一把钥匙拒绝；已有钥匙的设备再登记另一把也拒绝', async () => {
  const s = await setup(false);
  const requestId = newRequestId('key');
  await call(s.t, 'POST', DEVICE_KEYS_PATH, { cookie: s.cookie, body: { requestId, publicKey: s.key.publicJwk } });
  const other = newDeviceKey();
  const swapped = await call(s.t, 'POST', DEVICE_KEYS_PATH, {
    cookie: s.cookie,
    body: { requestId, publicKey: other.publicJwk },
  });
  assert.equal(swapped.status, 409);
  assert.equal(json(swapped)['code'], 'request_id_reused');
  const second = await registerKey(s.t, s.cookie, other);
  assert.equal(second.status, 409);
  assert.equal(json(second)['code'], 'device_key_exists');
  const same = await registerKey(s.t, s.cookie, s.key);
  assert.equal(same.status, 200);
});

test('配对超过 10 分钟才来登记钥匙：403 device_key_too_late，不存（旧登记规则保留，不再影响业务确认）', async () => {
  const s = await setup(false);
  s.t.clock.advance(DEVICE_KEY_REGISTRATION_WINDOW_MS + 60_000);
  const late = await registerKey(s.t, s.cookie, s.key);
  assert.equal(late.status, 403);
  assert.equal(json(late)['code'], 'device_key_too_late');
  assert.equal(json(await call(s.t, 'GET', DEVICE_KEYS_PATH, { cookie: s.cookie }))['key'], null);
});

test('同一把钥匙不能给两台在用的设备；撤销旧设备后，同一个浏览器重新配对可以带回原来的钥匙', async () => {
  const s = await setup();
  const otherCookie = await pair(s.t, '另一台电脑');
  const taken = await registerKey(s.t, otherCookie, s.key);
  assert.equal(taken.status, 409);
  assert.equal(json(taken)['code'], 'device_key_exists');
  const mine = json(await call(s.t, 'GET', DEVICE_KEYS_PATH, { cookie: s.cookie }));
  const current = mine['key'] as Record<string, unknown>;
  const revoked = await call(s.t, 'DELETE', `/v2/devices/${String(current['deviceId'])}`, { cookie: otherCookie });
  assert.equal(revoked.status, 200);
  const again = await pair(s.t, '原来那台重新配对');
  assert.equal((await registerKey(s.t, again, s.key)).status, 201);
  const reply = await signedCall(s.t, 'POST', PATH, toggle(s), { ...s, cookie: again });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
});

test('登记钥匙时带私钥成员、或不是 P-256 曲线上的点：400，不存', async () => {
  const s = await setup(false);
  const withPrivate = { ...s.key.publicJwk, d: 'A'.repeat(43) };
  const leaked = await call(s.t, 'POST', DEVICE_KEYS_PATH, {
    cookie: s.cookie,
    body: { requestId: newRequestId('key'), publicKey: withPrivate },
  });
  assert.equal(leaked.status, 400);
  const offCurve = { ...s.key.publicJwk, y: 'A'.repeat(43) };
  const bad = await call(s.t, 'POST', DEVICE_KEYS_PATH, {
    cookie: s.cookie,
    body: { requestId: newRequestId('key'), publicKey: offCurve },
  });
  assert.equal(bad.status, 400);
  assert.equal(json(await call(s.t, 'GET', DEVICE_KEYS_PATH, { cookie: s.cookie }))['key'], null);
});
