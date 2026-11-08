import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { NodeActionEnvelope, NodeActionReport } from '../../shared/api/index.ts';
import { DEVICE_PER_HOUR_MAX } from '../../shared/state.ts';
import { DEFAULT_DEVICE_LIMITS, type NodeTransport } from '../../src/devices/index.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, signedCall, type TestDeviceKey } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

interface Signed {
  t: TestApp;
  cookie: string;
  key: TestDeviceKey;
}

const sent: NodeActionEnvelope[] = [];
const transport: NodeTransport = {
  send(envelope): Promise<NodeActionReport> {
    sent.push(envelope);
    return Promise.resolve({ actionId: envelope.actionId, status: 'executed', executedAt: envelope.issuedAt });
  },
};

async function signedApp(): Promise<Signed> {
  sent.length = 0;
  t = await startTestApp([], { nodeTransport: transport });
  const cookie = await pair(t);
  const key = newDeviceKey();
  t.clock.advance(20 * 60_000);
  return { t, cookie, key };
}

async function issueCode(s: Signed, requestId = newRequestId('code')): Promise<{ code: string; requestId: string }> {
  const reply = await signedCall(s.t, 'POST', '/v2/nodes/pairing-codes', { requestId }, s);
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return { code: String(json(reply)['code']), requestId };
}

function pairBody(code: string, requestId = newRequestId('pair')) {
  return {
    requestId,
    code,
    name: '家里的 Mac',
    platform: 'macos',
    appVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: ['file_read', 'file_list'],
  };
}

async function pairNode(s: Signed): Promise<{ nodeId: string; credential: string }> {
  const { code } = await issueCode(s);
  const reply = await call(s.t, 'POST', '/v2/nodes/pair', { body: pairBody(code) });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return { nodeId: String(json(reply)['nodeId']), credential: String(json(reply)['credential']) };
}

function hello(s: Signed, credential: string) {
  const body = { appVersion: '0.1.1', protocolVersion: 1, capabilities: ['file_read'] };
  return call(s.t, 'POST', '/v2/nodes/hello', { body, headers: { authorization: `Bearer ${credential}` } });
}

test('老的本人会话无钥匙也能领取节点配对码', async () => {
  const s = await signedApp();
  const unsigned = await signedCall(s.t, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId() }, {
    ...s,
    unsigned: true,
  });
  assert.equal(unsigned.status, 201);
  assert.equal(typeof json(unsigned)['code'], 'string');
});

test('领码的回答丢了重发：换一个新码，旧码作废；明文的码不进接口回执', async () => {
  const s = await signedApp();
  const first = await issueCode(s, 'code-request-0001');
  const second = await issueCode(s, 'code-request-0001');
  assert.notEqual(second.code, first.code);
  const stale = await call(s.t, 'POST', '/v2/nodes/pair', { body: pairBody(first.code) });
  assert.equal(stale.status, 401);
  assert.equal(json(stale)['code'], 'pairing_code_used');
  const stored = JSON.stringify(s.t.state.apiRequests.find('code-request-0001'));
  assert.equal(stored.includes(second.code), false);
  assert.equal(stored.includes(second.code.replace('-', '')), false);
  const fresh = await call(s.t, 'POST', '/v2/nodes/pair', { body: pairBody(second.code) });
  assert.equal(fresh.status, 201);
});

test('节点配对：码换凭证；回答丢了用同一个 requestId 重发，给同一台节点换新凭证，旧的随即失效', async () => {
  const s = await signedApp();
  const { code } = await issueCode(s);
  const body = pairBody(code, 'pair-request-0001');
  const first = await call(s.t, 'POST', '/v2/nodes/pair', { body });
  const again = await call(s.t, 'POST', '/v2/nodes/pair', { body });
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(again.headers.get('x-plasticine-replayed'), '1');
  assert.equal(json(again)['nodeId'], json(first)['nodeId']);
  assert.equal((await hello(s, String(json(first)['credential']))).status, 401);
  const ok = await hello(s, String(json(again)['credential']));
  assert.equal(ok.status, 200);
  assert.deepEqual(json(ok)['limits'], DEFAULT_DEVICE_LIMITS);
  const classes = (json(ok)['limits'] as { classes: Record<string, { perHour: number }> }).classes;
  assert.deepEqual(Object.fromEntries(Object.entries(classes).map(([kind, limit]) => [kind, limit.perHour])), {
    read: DEVICE_PER_HOUR_MAX, write: DEVICE_PER_HOUR_MAX, delete: DEVICE_PER_HOUR_MAX,
    command: DEVICE_PER_HOUR_MAX, browser: DEVICE_PER_HOUR_MAX, input: DEVICE_PER_HOUR_MAX,
  });
  assert.equal(s.t.state.nodes.list().length, 1);
});

test('凭证失效：错的、空的凭证报到都是 401（节点凭证），不回显发来的东西', async () => {
  const s = await signedApp();
  await pairNode(s);
  const wrong = await hello(s, 'pn1_wrong-credential-value');
  assert.equal(wrong.status, 401);
  assert.equal(json(wrong)['code'], 'node_credential_invalid');
  assert.equal(JSON.stringify(wrong.body).includes('wrong-credential-value'), false);
  const empty = { appVersion: '1', protocolVersion: 1, capabilities: [] };
  const none = await call(s.t, 'POST', '/v2/nodes/hello', { body: empty });
  assert.equal(none.status, 401);
});

test('本人会话改上限后节点拿到新上限；版本旧了 409 带现在那份；同一请求重发只改一次', async () => {
  const s = await signedApp();
  const { nodeId, credential } = await pairNode(s);
  const limits = { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Documents/Plasticine'] };
  const path = `/v2/nodes/${nodeId}/limits`;
  const body = { requestId: 'limits-request-0001', limitsVersion: 0, limits };
  const changed = await call(s.t, 'POST', path, { cookie: s.cookie, body });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const node = json(changed)['node'] as Record<string, unknown>;
  assert.equal(node['limitsVersion'], 1);
  assert.equal(node['limitsAreDefault'], false);
  const replay = await signedCall(s.t, 'POST', path, body, s);
  assert.equal(replay.headers.get('x-plasticine-replayed'), '1');
  const stale = await signedCall(s.t, 'POST', path, { ...body, requestId: newRequestId() }, s);
  assert.equal(stale.status, 409);
  assert.equal((json(stale)['current'] as Record<string, unknown>)['limitsVersion'], 1);
  const reported = await hello(s, credential);
  assert.deepEqual(json(reported)['limits'], limits);
});

test('撤销节点：凭证立刻失效，之后的动作一律拒；重发撤销回同一个结果；事件流收到节点变了', async () => {
  const s = await signedApp();
  const { nodeId, credential } = await pairNode(s);
  const stream = await openEvents(s.t, s.cookie);
  try {
    const body = { requestId: 'revoke-request-0001' };
    const revoked = await call(s.t, 'POST', `/v2/nodes/${nodeId}/revoke`, { cookie: s.cookie, body });
    assert.equal(revoked.status, 200);
    const event = await stream.next('node_changed');
    assert.equal(event.event.type === 'node_changed' ? event.event.node.revokedAt !== null : false, true);
    const again = await call(s.t, 'POST', `/v2/nodes/${nodeId}/revoke`, { cookie: s.cookie, body });
    assert.equal(again.headers.get('x-plasticine-replayed'), '1');
    assert.equal((await hello(s, credential)).status, 401);
    const outcome = await s.t.app.deps.devices.actions.perform({
      actionId: 'after-revoke',
      nodeId,
      action: { kind: 'file_read', path: '~/Documents/a.md' },
      origin: 'user',
    });
    assert.equal(outcome.refusalLayer, 'node');
    assert.equal(sent.length, 0);
  } finally {
    stream.close();
  }
});

test('设备动作超上限被拒并报告：动作列表里是被拒和原因，事件流推给界面', async () => {
  const s = await signedApp();
  const { nodeId } = await pairNode(s);
  const limits = {
    ...DEFAULT_DEVICE_LIMITS,
    roots: ['~/Documents'],
    classes: { ...DEFAULT_DEVICE_LIMITS.classes, read: { mode: 'allow' as const, perHour: 1 } },
  };
  const set = await signedCall(s.t, 'POST', `/v2/nodes/${nodeId}/limits`, {
    requestId: newRequestId(),
    limitsVersion: 0,
    limits,
  }, s);
  assert.equal(set.status, 200);
  const stream = await openEvents(s.t, s.cookie);
  try {
    const action = { kind: 'file_read' as const, path: '~/Documents/a.md' };
    const { devices } = s.t.app.deps;
    // The test service runs in the development dry run (decision 68): checked and counted, never sent.
    const first = await devices.actions.perform({ actionId: 'r1', nodeId, action, origin: 'brain' });
    assert.equal(first.status, 'dry_run');
    const over = await devices.actions.perform({ actionId: 'r2', nodeId, action, origin: 'brain' });
    assert.equal(over.refusalLayer, 'count');
    let refused = await stream.next('node_action_recorded');
    while (refused.event.type === 'node_action_recorded' && refused.event.action.actionId !== 'r2') {
      refused = await stream.next('node_action_recorded');
    }
    assert.equal(refused.event.type === 'node_action_recorded' ? refused.event.action.refusalLayer : '', 'count');
  } finally {
    stream.close();
  }
  const listed = await call(s.t, 'GET', `/v2/nodes/actions?nodeId=${nodeId}`, { cookie: s.cookie });
  const actions = json(listed)['actions'] as Record<string, unknown>[];
  assert.equal(actions[0]?.['status'], 'refused');
  assert.match(String(actions[0]?.['reason']), /到了上限 1 次/);
  assert.equal(sent.length, 0);
});

test('节点凭证和配对码的明文都不在库文件里', async () => {
  const s = await signedApp();
  const { code } = await issueCode(s);
  const reply = await call(s.t, 'POST', '/v2/nodes/pair', { body: pairBody(code) });
  const credential = String(json(reply)['credential']);
  const directory = s.t.directory;
  await s.t.close(true);
  t = undefined;
  const files = ['plasticine.sqlite', 'plasticine.sqlite-wal'];
  for (const file of files) {
    const bytes = await readFile(join(directory, file)).catch(() => Buffer.alloc(0));
    assert.equal(bytes.includes(credential), false, file);
    assert.equal(bytes.includes(code), false, file);
  }
});
