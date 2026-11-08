import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_DEVICE_LIMITS } from '../../src/devices/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, signedCall } from './signing.ts';

let t: TestApp | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

async function setup() {
  t = await startTestApp([], { dryRun: false });
  const cookie = await pair(t);
  const key = newDeviceKey();
  t.clock.advance(20 * 60_000);
  const signed = { t, cookie, key };
  const codeReply = await signedCall(t, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId() }, signed);
  const paired = await call(t, 'POST', '/v2/nodes/pair', { body: { requestId: newRequestId(),
    code: json(codeReply)['code'], name: 'Mac', platform: 'macos', appVersion: '1.0', protocolVersion: 1,
    capabilities: ['file_read', 'file_write', 'file_delete', 'screen_capture'] } });
  const nodeId = String(json(paired)['nodeId']);
  const headers = { authorization: `Bearer ${String(json(paired)['credential'])}` };
  await signedCall(t, 'POST', `/v2/nodes/${nodeId}/limits`, { requestId: newRequestId(), limitsVersion: 0,
    limits: { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Documents'] } }, signed);
  return { ...signed, nodeId, headers };
}

test('节点 HTTP 通道：Bearer 鉴权、204 空体、心跳、200 动作原样、结果幂等和 409', async () => {
  const s = await setup();
  const path = '/v2/nodes/actions/next?wait=0';
  assert.equal((await call(s.t, 'GET', path)).status, 401);
  const before = s.t.state.nodes.require(s.nodeId).lastSeenAt;
  const empty = await call(s.t, 'GET', path, { headers: s.headers });
  assert.equal(empty.status, 204);
  assert.notEqual(s.t.state.nodes.require(s.nodeId).lastSeenAt, before);
  assert.equal((await call(s.t, 'GET', '/v2/nodes/actions/next?wait=26', { headers: s.headers })).status, 400);
  const content = '中文 https://example.test/a?view=plain#section';
  const done = s.t.app.deps.devices.actions.perform({ actionId: 'wire-write', nodeId: s.nodeId, origin: 'brain',
    action: { kind: 'file_write', path: '~/Documents/a.md', content, baseVersion: null } });
  const next = await call(s.t, 'GET', path, { headers: s.headers });
  assert.equal(next.status, 200);
  const wire = json(next)['action'] as Record<string, unknown>;
  assert.deepEqual(wire['params'], { path: '~/Documents/a.md', content, baseVersion: null });
  assert.deepEqual(Object.keys(wire).sort(), ['deadline', 'id', 'kind', 'params']);
  assert.equal(wire['id'], 'wire-write');
  const body = { status: 'refused', error: '文件已被改过', refusalLayer: 'device' };
  const resultPath = '/v2/nodes/actions/wire-write/result';
  const first = await call(s.t, 'POST', resultPath, { headers: s.headers, body });
  assert.equal(first.status, 200);
  assert.equal((await done).reason, '文件已被改过');
  const again = await call(s.t, 'POST', resultPath, { headers: s.headers, body });
  assert.deepEqual(again.body, first.body);
  const conflict = await call(s.t, 'POST', resultPath, { headers: s.headers,
    body: { status: 'executed', result: { version: 'a'.repeat(64) } } });
  assert.equal(conflict.status, 409);
});

test('删除先出授权卡；本人老会话无需钥匙即可授权入队，重放不多发', async () => {
  const s = await setup();
  const devices = s.t.app.deps.devices;
  const ask = devices.approvals!.request({ actionId: 'approved-delete', nodeId: s.nodeId, origin: 'brain',
    action: { kind: 'file_delete', path: '~/Documents/旧笔记.md' } });
  assert.equal(ask.kind, 'approve');
  assert.equal(s.t.state.nodeActions.byActionId('approved-delete'), undefined);
  const path = `/v2/asks/${ask.id}/answer`;
  const body = { requestId: newRequestId(), optionId: 'allow' };
  const answer = await call(s.t, 'POST', path, { cookie: s.cookie, body });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const replay = await call(s.t, 'POST', path, { cookie: s.cookie, body });
  assert.equal(replay.status, 200);
  const changed = await call(s.t, 'POST', path, { cookie: s.cookie, body: { ...body, optionId: 'deny' } });
  assert.equal(changed.status, 409);
  assert.equal(json(changed)['code'], 'request_id_reused');
  assert.equal(s.t.state.nodeActions.byActionId('approved-delete')?.status, 'queued');
  const next = await call(s.t, 'GET', '/v2/nodes/actions/next?wait=0', { headers: s.headers });
  assert.equal(next.status, 200);
  const result = await call(s.t, 'POST', '/v2/nodes/actions/approved-delete/result',
    { headers: s.headers, body: { status: 'executed', result: {} } });
  assert.equal(result.status, 200);
  assert.equal((await call(s.t, 'GET', '/v2/nodes/actions/next?wait=0', { headers: s.headers })).status, 204);
});
