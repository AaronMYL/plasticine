import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { EnvelopeSchema, type Envelope } from '../../shared/net-wire.ts';
import {
  generateIdentityKeys,
  openEnvelope,
  requestSigningText,
  safetyCode,
  sealEnvelope,
  signEnvelope,
  signText,
  verifyText,
  type IdentityKeys,
} from '../../protocol/crypto.ts';

const ALICE = 'acct-alice-0001';
const BOB = 'acct-bob-00002';

function seal(from: IdentityKeys, to: IdentityKeys, plaintext: unknown, kind: Envelope['kind'] = 'text'): Envelope {
  return sealEnvelope({
    id: 'env-00000001',
    from: ALICE,
    to: BOB,
    sentAt: '2026-11-03T10:00:00.000Z',
    kind,
    plaintext,
    recipientEncryptionKey: to.encryption.publicKey,
    senderSigningPrivateKey: from.signing.privateKey,
  });
}

test('Two instances exchange valid wire envelope decryptable by recipient private key', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const envelope = seal(alice, bob, { text: '周六见', replyTo: null });
  assert.ok(Value.Check(EnvelopeSchema, envelope));
  assert.ok(!envelope.ciphertext.includes('周六见'));
  const opened = openEnvelope(envelope, alice.signing.publicKey, bob.encryption.privateKey);
  assert.deepEqual(opened, { ok: true, plaintext: { text: '周六见', replyTo: null } });
});

test('Encrypting identical text produces distinct ciphertext with fresh key and nonce', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const first = seal(alice, bob, { text: '一样的话' });
  const second = seal(alice, bob, { text: '一样的话' });
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(first.ephemeralKey, second.ephemeralKey);
});

test('Rejects tampered ciphertext, envelope header, or signature', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const envelope = seal(alice, bob, { text: '原话' });
  const flipped = Buffer.from(envelope.ciphertext, 'base64url');
  flipped[0] = (flipped[0] ?? 0) ^ 1;
  const cases: Envelope[] = [
    { ...envelope, ciphertext: flipped.toString('base64url') },
    { ...envelope, kind: 'ai_text' },
    { ...envelope, sentAt: '2026-11-03T10:00:01.000Z' },
    { ...envelope, to: 'acct-mallory01' },
    { ...envelope, signature: seal(alice, bob, { text: '别的' }).signature },
  ];
  for (const forged of cases) {
    const opened = openEnvelope(forged, alice.signing.publicKey, bob.encryption.privateKey);
    assert.equal(opened.ok, false);
  }
});

test('Re-signed envelope with altered header fails decryption due to AAD mismatch', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const { signature: _old, ...unsigned } = seal(alice, bob, { text: '原话' });
  const resigned = signEnvelope({ ...unsigned, kind: 'ai_text' }, alice.signing.privateKey);
  assert.deepEqual(openEnvelope(resigned, alice.signing.publicKey, bob.encryption.privateKey),
    { ok: false, reason: 'decrypt' });
});

test('Other private key cannot decrypt; spoofed sender fails signature verification', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const mallory = generateIdentityKeys();
  const envelope = seal(alice, bob, { text: '只给 Bob' });
  assert.equal(openEnvelope(envelope, alice.signing.publicKey, mallory.encryption.privateKey).ok, false);
  const forged = seal(mallory, bob, { text: '我是 Alice' });
  assert.deepEqual(openEnvelope(forged, alice.signing.publicKey, bob.encryption.privateKey),
    { ok: false, reason: 'signature' });
});

test('Safety number matches on both sides (12 groups of 5 digits) and changes with key', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const mine = safetyCode({ accountId: ALICE, signingKey: alice.signing.publicKey },
    { accountId: BOB, signingKey: bob.signing.publicKey });
  const theirs = safetyCode({ accountId: BOB, signingKey: bob.signing.publicKey },
    { accountId: ALICE, signingKey: alice.signing.publicKey });
  assert.equal(mine, theirs);
  assert.match(mine, /^(\d{5} ){11}\d{5}$/);
  const changed = safetyCode({ accountId: ALICE, signingKey: alice.signing.publicKey },
    { accountId: BOB, signingKey: generateIdentityKeys().signing.publicKey });
  assert.notEqual(changed, mine);
});

test('Request signature covers method, path with query, timestamp, nonce, and body', () => {
  const keys = generateIdentityKeys();
  const base = { method: 'get', path: '/v2/net/envelopes?after=3&wait=25', time: '2026-11-03T10:00:00.000Z',
    nonce: 'nonce-1', body: Buffer.alloc(0) };
  const text = requestSigningText(base);
  assert.ok(text.startsWith('GET\n/v2/net/envelopes?after=3&wait=25\n'));
  const signature = signText(keys.signing.privateKey, text);
  assert.ok(verifyText(keys.signing.publicKey, text, signature));
  assert.ok(!verifyText(keys.signing.publicKey, requestSigningText({ ...base, path: '/v2/net/envelopes?after=0' }),
    signature));
  assert.ok(!verifyText(keys.signing.publicKey, requestSigningText({ ...base, body: Buffer.from('{}') }), signature));
  assert.ok(!verifyText('not-a-key', text, signature));
});

test('Private key never leaks into public key, envelope, or signature', () => {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const envelope = JSON.stringify(seal(alice, bob, { text: 'x' }));
  for (const secret of [alice.signing.privateKey, alice.encryption.privateKey]) {
    assert.ok(!envelope.includes(secret));
    assert.notEqual(secret, alice.signing.publicKey);
  }
});
