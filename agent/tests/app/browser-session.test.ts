import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { BrowserSessions } from '../../src/app/browser-sessions.ts';
import { SESSION_TTL_MS } from '../../src/app/config.ts';
import { call, cookieFrom, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey } from './signing.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function fixture() {
  const t = await startTestApp([], { startTasks: false });
  app = t;
  const user = await pair(t);
  const device = t.state.devices.list()[0]!;
  const service = t.app.deps.devices;
  const issued = service.issueCode(device.id);
  const paired = service.pair(service.findCode(issued.code)!, { code: issued.code,
    requestId: newRequestId(), name: 'Mac', platform: 'macos', appVersion: '0.7.4', protocolVersion: 1,
    capabilities: ['tab_open', 'tab_read'] });
  const headers = { authorization: `Bearer ${paired.credential}` };
  return { t, user, paired, headers };
}

test('已配对节点打开自身网页用独立系统会话，不要求配对码，也不能登记用户确认钥匙', async () => {
  const { t, user, headers } = await fixture();
  const opened = await call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} });
  assert.equal(opened.status, 201);
  const cookie = cookieFrom(opened);
  assert.notEqual(cookie, user);
  assert.match(opened.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(JSON.stringify(opened.body).includes(cookie.split('=')[1]!), false);
  const session = await call(t, 'GET', '/v2/session', { cookie });
  assert.equal(session.status, 200);
  assert.equal(json(session)['actor'], 'system');
  const repeated = await call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} });
  assert.equal(cookieFrom(repeated), cookie, '同一个内部浏览器复用有效会话');
  assert.equal((await registerKey(t, cookie, newDeviceKey())).status, 403);
  assert.equal((await registerKey(t, user, newDeviceKey())).status, 201);
});

test('没有节点凭证不能换内部会话，localhost 和 Plasticine UA 不产生登录权限', async () => {
  const { t, user } = await fixture();
  assert.equal((await call(t, 'POST', '/v2/nodes/browser-session', { cookie: user, body: {} })).status, 401);
  assert.equal((await call(t, 'GET', '/v2/session', { headers: { 'user-agent': 'PlasticineMac/0.7.4' } })).status, 401);
});

test('系统会话发到主线的文字记录真实 system 来源，撤销节点同时使会话失效', async () => {
  const { t, paired, headers } = await fixture();
  const opened = await call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} });
  assert.equal(opened.status, 201);
  const cookie = cookieFrom(opened);
  t.respond([fauxAssistantMessage('收到内部任务')]);
  const sent = await call(t, 'POST', '/v2/lines/main/messages', { cookie,
    body: { requestId: newRequestId(), text: '浏览器中的内部任务' } });
  assert.equal(sent.status, 200);
  const messages = t.state.lineMessages.after('line-main', 0);
  assert.equal(messages.find((row) => row.role === 'user')?.meta?.origin?.kind, 'system');
  t.state.nodes.update(paired.node.id, paired.node.version, { revokedAt: t.clock.now().toISOString() });
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 401);
  assert.equal((await call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} })).status, 401);
});

test('内部浏览器创建的笔记归 AI，本人发送、配对邀请和确认入口不能借系统会话操作', async () => {
  const { t, user, headers } = await fixture();
  const opened = await call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} });
  const cookie = cookieFrom(opened);
  const created = await call(t, 'POST', '/v2/notes', { cookie,
    body: { requestId: newRequestId(), markdown: '内部浏览器写的笔记' } });
  assert.equal(created.status, 201);
  assert.equal(json(created)['author'], 'ai');
  const personal = await call(t, 'POST', '/v2/notes', { cookie: user,
    body: { requestId: newRequestId(), markdown: '本人写的笔记' } });
  assert.equal(json(personal)['author'], 'user');
  const personalPaths = ['/v2/contacts/contact_missing/messages',
    '/v2/inbox/message_missing/replies', '/v2/inbox/feedback', '/v2/feed/items/item_missing/comments',
    '/v2/asks/ask_missing/answer', '/v2/lines/main/widgets', '/v2/contacts/add',
    '/v2/contacts/contact_missing/request', '/v2/contacts/contact_missing/relation',
    '/v2/contacts/contact_missing/safety', '/v2/contacts/contact_missing/tasks',
    '/v2/network-tasks/task_missing/cancel', '/v2/network-tasks/task_missing/stop',
    '/v2/network-tasks/task_missing/decide', '/v2/network-tasks/task_missing/deliver',
    '/v2/network-tasks/task_missing/verdict', '/v2/group-tasks/task_missing/claim',
    '/v2/group-tasks/task_missing/cancel', '/v2/visibility/marks', '/v2/visibility/confirm',
    '/v2/feed/items/item_missing/reaction'];
  for (const path of personalPaths) {
    const denied = await call(t, 'POST', path, { cookie, body: { requestId: newRequestId(), text: '不能记成本人' } });
    assert.equal(denied.status, 403, path);
    assert.equal(json(denied)['code'], 'user_confirmation_required', path);
  }
  // 账号（2026-11-08）：内部浏览器不能替他改密码、改名字。
  for (const [method, path, body] of [['PUT', '/v2/account/password', { password: 'fake-new-pass-9' }],
    ['PATCH', '/v2/account', { displayName: '内部浏览器' }]] as const) {
    const denied = await call(t, method, path, { cookie, body });
    assert.equal(denied.status, 403, path);
  }
});

test('自访会话正常过期与登出；重启只重发系统会话，撤销内部设备以后不自动重建', async () => {
  const { t, user, paired, headers } = await fixture();
  const open = () => call(t, 'POST', '/v2/nodes/browser-session', { headers, body: {} });
  const first = cookieFrom(await open());
  t.clock.advance(SESSION_TTL_MS + 1);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: first })).status, 401);
  const renewed = cookieFrom(await open());
  assert.notEqual(renewed, first);
  assert.equal((await call(t, 'DELETE', '/v2/session', { cookie: renewed })).status, 200);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: renewed })).status, 401);
  const restarted = new BrowserSessions(t.state, t.clock.now).open(paired.node);
  const nextCookie = restarted.cookie.split(';')[0]!;
  assert.equal(json(await call(t, 'GET', '/v2/session', { cookie: nextCookie }))['actor'], 'system');
  assert.equal(JSON.stringify(t.state.kernelSettings.get('internal_browser_identities'))
    .includes(nextCookie.split('=')[1]!), false);
  // 原用户会话也已过期；在测试里重新正常配对，才由本人撤销内部设备。
  const freshUser = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: user })).status, 401);
  assert.equal((await call(t, 'DELETE', `/v2/devices/${restarted.device.id}`, { cookie: freshUser })).status, 200);
  assert.equal((await call(t, 'GET', '/v2/session', { cookie: nextCookie })).status, 401);
  const count = t.state.devices.list().length;
  assert.equal((await open()).status, 403);
  assert.equal(t.state.devices.list().length, count);
});

test('云端自访精确绑定配置源；撤销后清掉本站 Cookie，不恢复成导入的本人登录', async () => {
  const { t } = await fixture();
  const sessions = new BrowserSessions(t.state, t.clock.now);
  const first = sessions.cookies('http://plasticine.test:8790/')[0]!;
  assert.equal(first.url, 'http://plasticine.test:8790/');
  assert.equal(first.httpOnly, true);
  assert.equal(first.secure, false);
  const cookie = `${first.name}=${first.value}`;
  assert.equal(json(await call(t, 'GET', '/v2/session', { cookie }))['actor'], 'system');
  const device = sessions.open().device;
  t.state.devices.revoke(device.id, t.clock.now().toISOString());
  assert.equal((await call(t, 'GET', '/v2/session', { cookie })).status, 401);
  assert.deepEqual(sessions.cookies('http://plasticine.test:8790/'), [{ ...first, value: '', expires: 0 }]);
});
