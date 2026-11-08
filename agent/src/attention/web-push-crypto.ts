// The two pieces of Web Push that need cryptography, written on node:crypto instead of adding the `web-push`
// package (plasticine-code：不引新依赖，除非替代方案不行): the payload encryption of RFC 8291 (aes128gcm, RFC 8188)
// and the VAPID authorization of RFC 8292 (an ES256 JWT). The encryption is checked against RFC 8291 Appendix A.

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  ECDH,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

const CURVE = 'prime256v1';
// RFC 8291 §2: an uncompressed P-256 point is 65 bytes, the auth secret 16.
const PUBLIC_KEY_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
const SALT_BYTES = 16;
// RFC 8188 record size: one record holds the whole (small) payload; 4096 is what every push service accepts.
const RECORD_SIZE = 4096;
const CEK_BYTES = 16;
const NONCE_BYTES = 12;
// RFC 8188 §2: the last (here the only) record ends with the delimiter 0x02.
const LAST_RECORD_DELIMITER = 0x02;
// RFC 8292 §2: a JWT may live at most 24 hours; 12 leaves room for clock differences.
export const VAPID_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export interface VapidKeys {
  /** base64url of the 65-byte uncompressed public key: what PushManager.subscribe gets as applicationServerKey. */
  publicKey: string;
  /** base64url of the 32-byte private scalar. Never logged, never sent. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HKDF-Expand with one block (RFC 5869), enough for every length used here (≤ 32 bytes). */
function expand(prk: Buffer, info: Buffer, length: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export interface SubscriberKeys {
  /** base64url, the browser's P-256 public key. */
  p256dh: string;
  /** base64url, the browser's 16-byte auth secret. */
  auth: string;
}

/** Fixed salt and server key for the RFC test vector; left out, both are fresh for every message. */
export interface EncryptionSeed {
  salt: Buffer;
  serverPrivateKey: Buffer;
}

export function decodeSubscriberKeys(keys: SubscriberKeys): { publicKey: Buffer; authSecret: Buffer } {
  const publicKey = Buffer.from(keys.p256dh, 'base64url');
  const authSecret = Buffer.from(keys.auth, 'base64url');
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 0x04) {
    throw new Error('p256dh 不是 65 字节的未压缩 P-256 公钥');
  }
  // Length and prefix right is not enough: the point must lie on the curve, or every push to it fails (d2923e7 P2).
  try {
    ECDH.convertKey(publicKey, CURVE);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'Error';
    throw new Error(`p256dh 不是 P-256 曲线上的点（${code}）`, { cause: error });
  }
  if (authSecret.length !== AUTH_SECRET_BYTES) {
    throw new Error('auth 不是 16 字节');
  }
  return { publicKey, authSecret };
}

/** RFC 8291 §3.4: the body of the push message (header + one aes128gcm record). */
export function encryptPayload(plaintext: Buffer, keys: SubscriberKeys, seed?: EncryptionSeed): Buffer {
  const { publicKey: uaPublic, authSecret } = decodeSubscriberKeys(keys);
  const ecdh = createECDH(CURVE);
  if (seed === undefined) {
    ecdh.generateKeys();
  } else {
    ecdh.setPrivateKey(seed.serverPrivateKey);
  }
  const asPublic = ecdh.getPublicKey();
  const salt = seed?.salt ?? randomBytes(SALT_BYTES);
  const sharedSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = expand(hmac(authSecret, sharedSecret), keyInfo, 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), CEK_BYTES);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0', 'latin1'), NONCE_BYTES);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([plaintext, Buffer.from([LAST_RECORD_DELIMITER])]);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, encrypted]);
}

function privateKeyObject(keys: VapidKeys): KeyObject {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
  const point = ecdh.getPublicKey();
  // The JWK form needs x and y: the two 32-byte halves of the uncompressed point after its 0x04 prefix.
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: keys.privateKey,
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33, 65).toString('base64url'),
  };
  return createPrivateKey({ key: jwk, format: 'jwk' });
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * RFC 8292 §3: `vapid t=<JWT>, k=<public key>` for one push service origin. `subject` is the contact the push
 * service may use (an https URL or mailto:).
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: Date): string {
  const audience = new URL(endpoint).origin;
  const expiresAt = Math.floor((now.getTime() + VAPID_TOKEN_TTL_MS) / 1000);
  const unsigned = `${base64urlJson({ typ: 'JWT', alg: 'ES256' })}.${base64urlJson({
    aud: audience,
    exp: expiresAt,
    sub: subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}
