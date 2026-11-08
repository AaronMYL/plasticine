// A browser's side of Web Push for the tests: a subscription key pair, and decryption of what the server sent
// (RFC 8291 §3.4 read backwards), so a test can check what a push really carries.

import { createDecipheriv, createECDH, createHmac, randomBytes, type ECDH } from 'node:crypto';

export interface FakeBrowser {
  keys: { p256dh: string; auth: string };
  decrypt(body: Buffer): string;
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function expand(prk: Buffer, info: string | Buffer, length: number): Buffer {
  const bytes = typeof info === 'string' ? Buffer.from(info, 'latin1') : info;
  return hmac(prk, Buffer.concat([bytes, Buffer.from([1])])).subarray(0, length);
}

// RFC 8188 header: salt (16) · record size (4) · key id length (1) · key id.
const SALT_BYTES = 16;
const HEADER_FIXED = SALT_BYTES + 4 + 1;
const TAG_BYTES = 16;

export function fakeBrowser(): FakeBrowser {
  const ecdh: ECDH = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const uaPublic = ecdh.getPublicKey();
  return {
    keys: { p256dh: uaPublic.toString('base64url'), auth: auth.toString('base64url') },
    decrypt(body) {
      const salt = body.subarray(0, SALT_BYTES);
      const idLength = body[SALT_BYTES + 4] ?? 0;
      const asPublic = body.subarray(HEADER_FIXED, HEADER_FIXED + idLength);
      const record = body.subarray(HEADER_FIXED + idLength);
      const secret = ecdh.computeSecret(asPublic);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
      const ikm = expand(hmac(auth, secret), keyInfo, 32);
      const prk = hmac(salt, ikm);
      const decipher = createDecipheriv(
        'aes-128-gcm',
        expand(prk, 'Content-Encoding: aes128gcm\0', 16),
        expand(prk, 'Content-Encoding: nonce\0', 12),
      );
      decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
      const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_BYTES)), decipher.final()]);
      const end = padded.lastIndexOf(0x02);
      return padded.subarray(0, end).toString('utf8');
    },
  };
}
