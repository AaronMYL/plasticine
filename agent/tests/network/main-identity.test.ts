// 第 12 批：主线的名字可以自己起。改名后队友列表带着它、主线的提示词里自称用它；加入了网络就再发一次资料，
// 每个好友那边收到 aiName；没改过（还叫 Plasticine）时 aiName 是 null。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { identitySection } from '../../src/lines/prompt.ts';
import { aiNameOf } from '../../src/mates/main-identity.ts';
import { call, json, pair, startTestApp, type TestApp } from '../app/helpers.ts';
import { post, type Body } from './helpers.ts';

const opened: TestApp[] = [];

afterEach(async () => {
  for (const started of opened.splice(0)) await started.close();
});

async function joined(): Promise<{ t: TestApp; cookie: string; contactId: string }> {
  const t = await startTestApp([], { startTasks: false, network: { relayUrl: 'http://127.0.0.1:9', autoSync: false } });
  opened.push(t);
  const me = generateIdentityKeys();
  const at = t.clock.now().toISOString();
  t.state.networkIdentity.create({ accountId: 'acct-me-0001', handle: 'alex', displayName: 'Alex',
    relayUrl: 'http://127.0.0.1:9', signingPublicKey: me.signing.publicKey, signingPrivateKey: me.signing.privateKey,
    encryptionPublicKey: me.encryption.publicKey, encryptionPrivateKey: me.encryption.privateKey, joinedAt: at });
  const them = generateIdentityKeys();
  const contact = t.state.contacts.create({ accountId: 'acct-sam-0001', handle: 'samwise', displayName: 'samwise',
    signingKey: them.signing.publicKey, encryptionKey: them.encryption.publicKey, relation: 'friend',
    state: 'active', lastAt: at });
  return { t, cookie: await pair(t), contactId: contact.id };
}

test('没改过：队友列表里主线叫 Plasticine，发给好友的 aiName 是 null', async () => {
  const { t, cookie } = await joined();
  const list = json(await call(t, 'GET', '/v2/mates', { cookie }));
  assert.deepEqual(list['main'], { name: 'Plasticine' });
  assert.equal(aiNameOf(t.state), null);
});

test('改名：列表带新名字，提示词自称用它，资料再发给每个好友（带 aiName）', async () => {
  const { t, cookie, contactId } = await joined();
  const reply = await post(t, cookie, '/v2/main', { name: '阿泥' });
  assert.deepEqual(reply['main'], { name: '阿泥' });
  const list = json(await call(t, 'GET', '/v2/mates', { cookie }));
  assert.equal((list['main'] as Body)['name'], '阿泥');
  assert.match(identitySection(undefined, '阿泥'), /^你叫阿泥/);
  assert.match(identitySection(), /^你是 Plasticine/);
  const sent = t.state.contactMessages.outboxDue('9999-12-31T00:00:00.000Z', 50)
    .find((row) => row.kind === 'profile' && row.contactId === contactId);
  assert.equal((sent?.payload as Body | undefined)?.['aiName'], '阿泥');
});
