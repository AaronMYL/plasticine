// 联系人接口：没加入网络、旧中继地址改连配置的中继、站内信并进联系人（邮件按地址归并能回、系统来源只读、
// Plasticine 通知不进）。开源版不带中继，要连中继的那几条（邀请码、请求、换钥匙、发件箱、关系冲突）不在这里。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { InboxMessageInput } from '../../shared/state.ts';
import { effectiveRelayUrl, generateIdentityKeys } from '../../src/network/index.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from '../app/helpers.ts';
import { contacts, post, thread, type Body } from './helpers.ts';

const opened: TestApp[] = [];

async function app(options: Parameters<typeof startTestApp>[1] = {}): Promise<TestApp> {
  const started = await startTestApp([], { startTasks: false, ...options });
  opened.push(started);
  return started;
}

afterEach(async () => {
  for (const started of opened.splice(0)) {
    await started.close();
  }
});

test('没加入网络：状态说没加入、给默认中继地址；联系人那几样写回 409 not_joined；没登录 401', async () => {
  const t = await app();
  assert.equal((await call(t, 'GET', '/v2/network')).status, 401);
  const cookie = await pair(t);
  const status = json(await call(t, 'GET', '/v2/network', { cookie }));
  assert.deepEqual(status, { joined: false, relayUrl: 'https://cyberhunter.top', account: null, lastSyncAt: null,
    lastError: null, inviteNeeded: false, welcome: false, tunnel: null });
  const add = await call(t, 'POST', '/v2/contacts/add', { cookie, body: { requestId: 'add-req-0001',
    handle: 'someone' } });
  assert.equal(add.status, 409);
  assert.equal(json(add)['code'], 'not_joined');
  assert.deepEqual(json(await call(t, 'GET', '/v2/contacts', { cookie })), { contacts: [], requests: 0, waiting: 0,
    unread: 0 });
});

test('中继独立以前记下的旧地址（本机 8790）：改连配置的中继；别的地址照记下的连', async () => {
  for (const legacy of ['http://127.0.0.1:8790', 'http://localhost:8790/']) {
    assert.equal(effectiveRelayUrl(legacy, 'http://127.0.0.1:8791'), 'http://127.0.0.1:8791');
  }
  assert.equal(effectiveRelayUrl('https://relay.example.com/', 'https://cyberhunter.top'),
    'https://relay.example.com');
  assert.equal(effectiveRelayUrl(undefined, 'https://cyberhunter.top'), 'https://cyberhunter.top');
  const t = await app({ network: { relayUrl: 'http://127.0.0.1:8791', autoSync: false } });
  const keys = generateIdentityKeys();
  t.state.networkIdentity.create({ accountId: 'acct-legacy-0001', handle: 'alex', displayName: 'Alex',
    relayUrl: 'http://127.0.0.1:8790', signingPublicKey: keys.signing.publicKey,
    signingPrivateKey: keys.signing.privateKey, encryptionPublicKey: keys.encryption.publicKey,
    encryptionPrivateKey: keys.encryption.privateKey, joinedAt: t.clock.now().toISOString() });
  const status = json(await call(t, 'GET', '/v2/network', { cookie: await pair(t) }));
  assert.equal(status['relayUrl'], 'http://127.0.0.1:8791');
});

function mail(t: TestApp, overrides: Partial<InboxMessageInput>): void {
  t.state.inboxMessages.add({ source: 'email', fromAddress: 'friend@example.com', fromName: '老朋友',
    title: '周末见', body: '周六下午三点。', receivedAt: t.clock.now().toISOString(),
    messageId: `<${Math.random()}@example.com>`, ...overrides });
}

test('站内信并进联系人：邮件按地址归并、能回（干跑只记）；系统来源只读；Plasticine 的通知不进', async () => {
  const t = await app();
  const cookie = await pair(t);
  mail(t, {});
  mail(t, { fromAddress: 'Friend@Example.com ', title: '改到周日' });
  mail(t, { source: 'feedback', fromAddress: '小雨', title: '按钮太小', messageId: null });
  mail(t, { source: 'plasticine', fromAddress: 'plasticine', title: 'Plasticine：任务做完了', messageId: null });
  const list = await contacts(t, cookie);
  const rows = list['contacts'] as Body[];
  assert.deepEqual(rows.map((row) => row['id']).sort(), ['mail:friend@example.com', 'system:feedback']);
  const friend = rows.find((row) => row['kind'] === 'mail') as Body;
  assert.equal(friend['unread'], 2);
  assert.equal(friend['name'], '老朋友');
  assert.equal(friend['canSend'], true);
  assert.equal((friend['last'] as Body)['text'], '改到周日');
  assert.equal(rows.find((row) => row['kind'] === 'system')?.['canSend'], false);
  assert.equal(list['unread'], 3);
  const events = await openEvents(t, cookie);
  const sent = await post(t, cookie, '/v2/contacts/mail%3Afriend%40example.com/messages', { text: '好的，周日见' });
  assert.equal((sent['message'] as Body)['author'], 'me');
  assert.equal((sent['message'] as Body)['dryRun'], true);
  const items = await thread(t, cookie, 'mail:friend@example.com');
  assert.deepEqual(items.map((item) => (item['message'] as Body)['author']), ['them', 'them', 'me']);
  const readOnly = await call(t, 'POST', '/v2/contacts/system%3Afeedback/messages', { cookie,
    body: { requestId: 'send-system-001', text: '谢谢' } });
  assert.equal(readOnly.status, 409);
  const read = await post(t, cookie, '/v2/contacts/mail%3Afriend%40example.com/read',
    { upTo: t.clock.now().toISOString() });
  assert.equal(read['marked'], 2);
  assert.equal(read['unread'], 1);
  const changed = await events.next('contacts_changed');
  events.close();
  assert.ok(changed.event.type === 'contacts_changed');
  const detail = json(await call(t, 'GET', '/v2/contacts/mail%3Afriend%40example.com', { cookie }));
  assert.equal(detail['safetyCode'], null);
  assert.equal((await call(t, 'GET', '/v2/contacts/mail%3Anobody%40example.com', { cookie })).status, 404);
});
