import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { configuredPublicUrl, publicUrlSource } from '../../src/app/public-url.ts';
import { identitySection } from '../../src/lines/prompt.ts';
import { openTestState } from '../state/helpers.ts';

function join(state: Awaited<ReturnType<typeof openTestState>>['state'], handle: string, relayUrl: string): void {
  const keys = generateIdentityKeys();
  state.networkIdentity.create({ accountId: 'acct-public-url-01', handle, displayName: 'Alex', relayUrl,
    signingPublicKey: keys.signing.publicKey, signingPrivateKey: keys.signing.privateKey,
    encryptionPublicKey: keys.encryption.publicKey, encryptionPrivateKey: keys.encryption.privateKey,
    joinedAt: '2026-11-08T09:00:00.000Z' });
}

test('offline without env var uses localhost URL with PLASTICINE_PORT instead of IP', async () => {
  const t = await openTestState();
  try {
    assert.equal(publicUrlSource(t.state, {})(), 'http://127.0.0.1:8790');
    assert.equal(publicUrlSource(t.state, { PLASTICINE_PORT: '9100' })(), 'http://127.0.0.1:9100');
    assert.doesNotMatch(identitySection(publicUrlSource(t.state, {})()), /43\.156\.80\.111/);
  } finally {
    await t.cleanup();
  }
});

test('with handle uses https://<hyphenated-handle>.cyberhunter.top without requiring restart', async () => {
  const t = await openTestState();
  try {
    const url = publicUrlSource(t.state, {});
    assert.equal(url(), 'http://127.0.0.1:8790');
    join(t.state, 'li_ming', 'https://cyberhunter.top');
    assert.equal(url(), 'https://li-ming.cyberhunter.top');
    assert.match(identitySection(url()), /网页 https:\/\/li-ming\.cyberhunter\.top/);
  } finally {
    await t.cleanup();
  }
});

test('co-located with relay (local port in identity) falls back to apex cyberhunter.top', async () => {
  const t = await openTestState();
  try {
    join(t.state, 'alex', 'http://127.0.0.1:8791');
    assert.equal(publicUrlSource(t.state, { PLASTICINE_NETWORK_URL: 'http://127.0.0.1:8791' })(),
      'https://alex.cyberhunter.top');
  } finally {
    await t.cleanup();
  }
});

test('PLASTICINE_PUBLIC_URL overrides handle (strips trailing slash); invalid value fails at wiring', async () => {
  const t = await openTestState();
  try {
    join(t.state, 'alex', 'https://cyberhunter.top');
    const env = { PLASTICINE_PUBLIC_URL: 'https://plasticine.example.test/' };
    assert.equal(publicUrlSource(t.state, env)(), 'https://plasticine.example.test');
    assert.equal(configuredPublicUrl({ PLASTICINE_PUBLIC_URL: ' ' }), null);
    assert.throws(() => publicUrlSource(t.state, { PLASTICINE_PUBLIC_URL: 'https://a.test/?x=1' }),
      /PLASTICINE_PUBLIC_URL/);
  } finally {
    await t.cleanup();
  }
});
