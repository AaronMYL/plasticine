import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import {
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
  VAPID_TOKEN_TTL_MS,
} from '../../src/attention/index.ts';

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3j' +
    'l7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('push payload encryption matches RFC 8291 Appendix A byte-for-byte', () => {
  const body = encryptPayload(
    Buffer.from(RFC.plaintext),
    { p256dh: RFC.uaPublic, auth: RFC.auth },
    { salt: Buffer.from(RFC.salt, 'base64url'), serverPrivateKey: Buffer.from(RFC.serverPrivate, 'base64url') },
  );
  assert.equal(body.toString('base64url'), RFC.body);
});

test('each push uses fresh salt and ephemeral key: ciphertexts differ and hide plaintext', () => {
  const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
  const first = encryptPayload(Buffer.from('要你动手'), keys);
  const second = encryptPayload(Buffer.from('要你动手'), keys);
  assert.notDeepEqual(first, second);
  assert.equal(first.includes(Buffer.from('要你动手')), false);
});

test('invalid subscription key length or format throws immediately without sending', () => {
  assert.throws(() => encryptPayload(Buffer.from('x'), { p256dh: 'AAAA', auth: RFC.auth }), /65 字节/);
  assert.throws(() => encryptPayload(Buffer.from('x'), { p256dh: RFC.uaPublic, auth: 'AAAA' }), /16 字节/);
});

test('VAPID token uses ES256, origin audience, <=12h expiry, verifies with server public key', () => {
  const keys = generateVapidKeys();
  const now = new Date('2026-10-27T08:00:00.000Z');
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://plasticine.test', now);
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(match !== null, header);
  const [, head = '', claims = '', signature = '', publicKey = ''] = match;
  assert.equal(publicKey, keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  const body = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { aud: string; exp: number; sub: string };
  assert.equal(body.aud, 'https://fcm.googleapis.com');
  assert.equal(body.sub, 'https://plasticine.test');
  assert.equal(body.exp, Math.floor((now.getTime() + VAPID_TOKEN_TTL_MS) / 1000));
  const point = Buffer.from(keys.publicKey, 'base64url');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33, 65).toString('base64url'),
  };
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${head}.${claims}`);
  const ok = verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  assert.equal(ok, true);
});
