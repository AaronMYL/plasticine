import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { call, json, openEvents, pair, startTestApp, type TestApp, newRequestId, send } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

async function toolsOffered(app: TestApp, cookie: string, requestId: string): Promise<string[]> {
  let offered: string[] = [];
  const step: FauxResponseFactory = (context) => {
    const names = new Set<string>();
    for (const message of context.messages) {
      if (message.role === 'system') {
        const prompt = typeof message.content === 'string' ? message.content
          : message.content.map((part) => part.text).join('');
        for (const name of /本轮实际可用工具：([^。\n]*)。/u.exec(prompt)?.[1]?.split('、') ?? []) {
          names.add(name);
        }
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

test('tool groups: cloud cmd defaults on without per-call approval, v0 unset, no self-iter group', async () => {
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

test('owner toggles tool group without key, logs confirm, notifies, model sees updated set next turn', async () => {
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

test('full-grant default does not override user disabling cloud cmd; stays hidden with real version', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const off = await send(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('ssh-off'), version: 0, enabled: false,
  }, { cookie });
  assert.equal(off.status, 200);
  const saved = t.state.toolGroups.get('cloud_ssh');
  assert.ok(saved?.confirmedByDeviceId);
  const groups = json(await call(t, 'GET', '/v2/tool-groups', { cookie }))['groups'] as Body[];
  assert.equal(groups.find((row) => row['id'] === 'cloud_ssh')?.['enabled'], false);
  assert.equal(groups.find((row) => row['id'] === 'cloud_ssh')?.['version'], 1);
  assert.equal((await toolsOffered(t, cookie, 'respect-ssh-off')).includes('cloud_ssh_run'), false);
  assert.deepEqual(t.state.toolGroups.get('cloud_ssh'), saved);
});

test('toggling tool group with stale version returns 409 with current; missing group returns 404', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const on = await send(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: true,
  }, { cookie });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  const stale = await send(t, 'POST', '/v2/tool-groups/cloud_ssh', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: false,
  }, { cookie });
  assert.equal(stale.status, 409);
  assert.equal(((json(stale)['current'] as Body)['enabled']), true);
  const missing = await send(t, 'POST', '/v2/tool-groups/rm_rf', {
    requestId: newRequestId('tg'),
    version: 0,
    enabled: true,
  }, { cookie });
  assert.equal(missing.status, 404);
});
