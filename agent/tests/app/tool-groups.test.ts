import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey, signedCall } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

/** 主线上说一句，看这一轮模型拿到哪些工具。 */
async function toolsOffered(app: TestApp, cookie: string, requestId: string): Promise<string[]> {
  let offered: string[] = [];
  const step: FauxResponseFactory = (context) => {
    // pi 的工具声明在系统消息上（toolsAdded / toolsRemoved），按顺序叠出这一轮能用的。
    const names = new Set<string>();
    for (const message of context.messages) {
      if (message.role === 'system') {
        for (const tool of message.toolsAdded ?? []) {
          names.add(tool.name);
        }
        for (const tool of message.toolsRemoved ?? []) {
          names.delete(tool.name);
        }
      }
    }
    offered = [...names];
    return fauxAssistantMessage('好');
  };
  app.respond([step]);
  const sent = await call(app, 'POST', '/v2/lines/line-main/messages', { cookie, body: { requestId, text: '你好' } });
  assert.equal(sent.status, 200);
  const deadline = Date.now() + 5_000;
  while ((offered.length === 0 || app.state.lines.main().status !== 'idle') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return offered;
}

test('列出工具组：云端命令默认开启，不编造逐次批准要求，未配置版本为0；没有自迭代那一组', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/tool-groups')).status, 401);
  const cookie = await pair(t);
  const groups = json(await call(t, 'GET', '/v2/tool-groups', { cookie }))['groups'] as Body[];
  const ssh = groups.find((group) => group['id'] === 'cloud_ssh');
  assert.equal(ssh?.['enabled'], true);
  assert.equal(ssh?.['version'], 0);
  assert.equal(groups.some((group) => String(group['description']).includes('要你批准')), false);
  assert.equal(groups.some((group) => group['id'] === 'self_code'), false);
  assert.equal(groups.find((group) => group['id'] === 'inbox')?.['enabled'], true);
});

test('本人会话无钥匙即可开关工具组，记录确认并通知，模型下一轮只看到开启的工具', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const before = await toolsOffered(t, cookie, 'req-00000101');
  assert.ok(before.includes('list_inbox'));
  assert.equal(before.includes('server_command'), true);
  assert.equal(before.includes('cloud_ssh_run'), false);
  const body = { requestId: newRequestId('tg'), version: 0, enabled: false };
  const events = await openEvents(t, cookie);
  const off = await call(t, 'POST', '/v2/tool-groups/inbox', { cookie, body });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(((json(off)['group'] as Body)['enabled']), false);
  const changed = await events.next('tool_group_changed');
  events.close();
  assert.ok(changed.event.type === 'tool_group_changed' && changed.event.group.enabled === false);
  assert.equal(t.state.toolGroups.get('inbox')?.confirmedByDeviceId !== null, true);
  const after = await toolsOffered(t, cookie, 'req-00000102');
  assert.equal(after.includes('list_inbox'), false);
  assert.equal(after.includes('read_inbox'), false);
  assert.ok(after.includes('get_time'));
});

test('全面授权的新默认不覆盖用户显式关闭云端命令，下一轮仍隐藏且保存真实确认版本', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const key = newDeviceKey();
  await registerKey(t, cookie, key);
  const off = await signedCall(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('ssh-off'), version: 0, enabled: false,
  }, { cookie, key });
  assert.equal(off.status, 200);
  const saved = t.state.toolGroups.get('cloud_ssh');
  assert.ok(saved?.confirmedByDeviceId);
  const groups = json(await call(t, 'GET', '/v2/tool-groups', { cookie }))['groups'] as Body[];
  assert.equal(groups.find((row) => row['id'] === 'cloud_ssh')?.['enabled'], false);
  assert.equal(groups.find((row) => row['id'] === 'cloud_ssh')?.['version'], 1);
  assert.equal((await toolsOffered(t, cookie, 'respect-ssh-off')).includes('cloud_ssh_run'), false);
  assert.deepEqual(t.state.toolGroups.get('cloud_ssh'), saved);
});

test('开关的版本旧了 409 带现在那一组；没有的组 404', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const key = newDeviceKey();
  await registerKey(t, cookie, key);
  const on = await signedCall(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: true,
  }, { cookie, key });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  const stale = await signedCall(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: false,
  }, { cookie, key });
  assert.equal(stale.status, 409);
  assert.equal(((json(stale)['current'] as Body)['enabled']), true);
  const missing = await signedCall(t, 'POST', '/v2/tool-groups/rm_rf', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: true,
  }, { cookie, key });
  assert.equal(missing.status, 404);
});
