import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, test } from 'node:test';
import { DEVICE_KEY_REGISTRATION_WINDOW_MS, REPLAYED_HEADER } from '../../shared/api/index.ts';
import { BrowserSessions } from '../../src/app/browser-sessions.ts';
import { SESSION_TTL_MS } from '../../src/app/config.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey } from './signing.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

const PATH = '/v2/tool-groups/inbox';

async function setup() {
  const t = await startTestApp([], { startTasks: false });
  app = t;
  const cookie = await pair(t);
  const device = t.state.devices.list()[0]!;
  return { t, cookie, device };
}

function toggle(t: TestApp, requestId = newRequestId()) {
  const current = t.state.toolGroups.get('inbox');
  return { requestId, version: current?.version ?? 0, enabled: !(current?.enabled ?? true) };
}

test('老的本人会话没有钥匙也能确认，来源取当前设备和服务端时间，不重新配对', async () => {
  const { t, cookie, device } = await setup();
  t.clock.advance(DEVICE_KEY_REGISTRATION_WINDOW_MS + 60_000);
  const before = t.clock.now().getTime();
  const reply = await call(t, 'POST', PATH, { cookie, body: toggle(t) });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const group = t.state.toolGroups.get('inbox');
  assert.equal(group?.enabled, false);
  assert.equal(group?.confirmedByDeviceId, device.id);
  assert.ok(Date.parse(group!.confirmedByDeviceAt!) >= before);
  assert.ok(Date.parse(group!.confirmedByDeviceAt!) <= t.clock.now().getTime());
  assert.equal(t.state.deviceKeys.liveFor(device.id), undefined);
  assert.deepEqual(t.state.devices.list().map((row) => row.id), [device.id]);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 200);
});

test('旧钥匙及缺失、损坏、过期签名头都不影响本人确认，旧钥匙记录不改', async () => {
  const { t, cookie, device } = await setup();
  assert.equal((await registerKey(t, cookie, newDeviceKey())).status, 201);
  const registered = t.state.deviceKeys.liveFor(device.id)!;
  const legacyHeaders: Record<string, string>[] = [
    {},
    { 'x-plasticine-signed-at': 'yesterday', 'x-plasticine-signature': 'invalid-legacy-header' },
    { 'x-plasticine-signed-at': '2000-01-01T00:00:00.000Z', 'x-plasticine-signature': 'old-legacy-header' },
    { 'x-plasticine-signature': 'incomplete-legacy-header' },
  ];
  for (const headers of legacyHeaders) {
    const reply = await call(t, 'POST', PATH, { cookie, headers, body: toggle(t) });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(t.state.toolGroups.get('inbox')?.confirmedByDeviceId, device.id);
    assert.deepEqual(t.state.deviceKeys.get(registered.id), registered);
  }
  const revoked = t.state.deviceKeys.revoke(registered.id, t.clock.now().toISOString());
  assert.equal((await call(t, 'POST', PATH, { cookie, body: toggle(t) })).status, 200);
  assert.deepEqual(t.state.deviceKeys.get(registered.id), revoked);
});

test('本人确认重试只写一次，同一请求改内容或路径仍拒绝，版本冲突仍返回当前版本', async () => {
  const { t, cookie } = await setup();
  const body = toggle(t);
  const first = await call(t, 'POST', PATH, { cookie, body });
  assert.equal(first.status, 200);
  t.clock.advance(20 * 60_000);
  const again = await call(t, 'POST', PATH, { cookie, body });
  assert.equal(again.headers.get(REPLAYED_HEADER), '1');
  assert.deepEqual(again.body, first.body);
  const changed = await call(t, 'POST', PATH, { cookie, body: { ...body, enabled: true } });
  assert.equal(changed.status, 409);
  assert.equal(json(changed)['code'], 'request_id_reused');
  const moved = await call(t, 'POST', '/v2/tool-groups/cloud_browser', { cookie, body });
  assert.equal(moved.status, 409);
  assert.equal(json(moved)['code'], 'request_id_reused');
  const stale = await call(t, 'POST', PATH, { cookie, body: { ...body, requestId: newRequestId() } });
  assert.equal(stale.status, 409);
  assert.equal(json(stale)['code'], 'version_conflict');
  assert.equal(t.state.toolGroups.get('inbox')?.version, 1);
});

test('确认不接受请求体伪造的设备和时间，另一台本人设备用自己的会话记来源', async () => {
  const { t, cookie, device } = await setup();
  const body = toggle(t);
  const forged = await call(t, 'POST', PATH, { cookie, body: { ...body,
    deviceId: 'not-the-session-device', confirmedAt: '2000-01-01T00:00:00.000Z' } });
  assert.equal(forged.status, 400);
  assert.equal(t.state.toolGroups.get('inbox'), undefined);
  const otherCookie = await pair(t, '另一台本人设备');
  const other = t.state.devices.list().find((row) => row.id !== device.id)!;
  const confirmed = await call(t, 'POST', PATH, { cookie: otherCookie, body,
    headers: { 'x-plasticine-signed-at': 'yesterday', 'x-plasticine-signature': 'old-device-header' } });
  assert.equal(confirmed.status, 200);
  assert.equal(t.state.toolGroups.get('inbox')?.confirmedByDeviceId, other.id);
});

test('没有会话、已登出、会话过期或设备撤销仍不能确认', async () => {
  const { t, cookie } = await setup();
  assert.equal((await call(t, 'POST', PATH, { body: toggle(t) })).status, 401);
  assert.equal((await call(t, 'DELETE', '/v2/session', { cookie })).status, 200);
  assert.equal((await call(t, 'POST', PATH, { cookie, body: toggle(t) })).status, 401);
  const expired = await pair(t, '会话过期的设备');
  t.clock.advance(SESSION_TTL_MS + 1);
  assert.equal((await call(t, 'POST', PATH, { cookie: expired, body: toggle(t) })).status, 401);
  const revoked = await pair(t, '撤销的设备');
  const device = t.state.devices.list().find((row) => row.name === '撤销的设备')!;
  t.state.devices.revoke(device.id, t.clock.now().toISOString());
  assert.equal((await call(t, 'POST', PATH, { cookie: revoked, body: toggle(t) })).status, 401);
  assert.equal(t.state.toolGroups.get('inbox'), undefined);
});

test('读取确认请求体期间登出，正文收完也不写入或保存成功回执', async () => {
  const { t, cookie } = await setup();
  const body = toggle(t);
  const text = JSON.stringify(body);
  const arrived = once(t.app.server, 'request');
  const reply = Promise.withResolvers<number>();
  const slow = request(`${t.base}${PATH}`, { method: 'POST', headers: {
    cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text),
  } }, (response) => { response.resume(); reply.resolve(response.statusCode ?? 0); });
  slow.on('error', reply.reject);
  try {
    slow.write(text.slice(0, -1));
    await arrived;
    assert.equal((await call(t, 'DELETE', '/v2/session', { cookie })).status, 200);
    slow.end(text.slice(-1));
    assert.equal(await reply.promise, 401);
    assert.equal(t.state.toolGroups.get('inbox'), undefined);
    assert.equal(t.state.apiRequests.find(body.requestId), undefined);
  } finally {
    slow.destroy();
  }
});

test('全部本人确认入口拒绝系统会话，不把内部浏览器记成本人', async () => {
  const { t } = await setup();
  const system = new BrowserSessions(t.state, t.clock.now).open();
  const cookie = system.cookie.split(';')[0]!;
  const paths = [
    '/v2/agreements/missing/confirm', '/v2/agreements/missing/edit',
    '/v2/memory/inferences/missing/confirm', '/v2/memory/inferences/missing/reject',
    '/v2/memory/uncertain/missing', '/v2/money/drafts/missing/confirm',
    '/v2/nodes/missing/limits', PATH, '/v2/asks/missing/answer', '/v2/nodes/pairing-codes',
    '/v2/backups/missing/restore',
  ];
  for (const path of paths) {
    const requestId = newRequestId();
    const denied = await call(t, 'POST', path, { cookie, body: { requestId } });
    assert.equal(denied.status, 403, path);
    assert.equal(json(denied)['code'], 'user_confirmation_required', path);
    assert.equal(t.state.apiRequests.find(requestId), undefined);
  }
  assert.equal(t.state.toolGroups.get('inbox'), undefined);
  assert.equal(t.state.deviceKeys.liveFor(system.device.id), undefined);
});
