import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { identitySection } from '../../src/lines/prompt.ts';
import { aiNameOf } from '../../src/mates/main-identity.ts';
import { call, json, pair, startTestApp, type TestApp, newRequestId } from '../app/helpers.ts';
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

test('Default main line name is Plasticine and aiName sent to friends is null', async () => {
  const { t, cookie } = await joined();
  const list = json(await call(t, 'GET', '/v2/mates', { cookie }));
  assert.deepEqual(list['main'], { name: 'Plasticine', variant: 'solid' });
  assert.equal(aiNameOf(t.state), null);
});

test('Renaming updates list, prompt self-name, and broadcasts updated aiName to friends', async () => {
  const { t, cookie, contactId } = await joined();
  const reply = await post(t, cookie, '/v2/main', { name: '阿泥' });
  assert.deepEqual(reply['main'], { name: '阿泥', variant: 'solid' });
  const list = json(await call(t, 'GET', '/v2/mates', { cookie }));
  assert.equal((list['main'] as Body)['name'], '阿泥');
  assert.match(identitySection(undefined, '阿泥'), /^你叫阿泥/);
  assert.match(identitySection(), /^你是 Plasticine/);
  const sent = t.state.contactMessages.outboxDue('9999-12-31T00:00:00.000Z', 50)
    .find((row) => row.kind === 'profile' && row.contactId === contactId);
  assert.equal((sent?.payload as Body | undefined)?.['aiName'], '阿泥');
});

test('Style change persists across renames; unknown style is rejected', async () => {
  const { t, cookie } = await joined();
  const reply = await post(t, cookie, '/v2/main', { name: '阿泥', variant: 'origami' });
  assert.deepEqual(reply['main'], { name: '阿泥', variant: 'origami' });
  const renamed = await post(t, cookie, '/v2/main', { name: '小泥' });
  assert.deepEqual(renamed['main'], { name: '小泥', variant: 'origami' });
  const bad = await call(t, 'POST', '/v2/main', { cookie, body: { requestId: newRequestId('rq'), name: '小泥',
    variant: 'crisp' } });
  assert.equal(bad.status, 400);
});
