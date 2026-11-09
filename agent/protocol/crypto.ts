// SPDX-License-Identifier: Apache-2.0
// 身份与加密（docs/specs/contacts-network.md 第 2 节），全用 node:crypto：
// - 每个实例两对钥匙：Ed25519 签名、X25519 加密。公钥是 32 字节原样的 base64url，私钥是 PKCS#8 DER 的 base64url；
//   私钥只给 state/ 存进本机库，不进日志、接口回答、测试快照（这里的函数从不把私钥放进返回的错误或文字）。
// - 中继请求签名：METHOD\nPATH\nTIME\nNONCE\nSHA256(body)，PATH 连同查询串（长轮询的 after / wait 也被签上）。
// - 一封信：临时 X25519 钥匙和收件人的加密公钥做 ECDH → HKDF-SHA256（salt = 临时公钥，info = cyber-hunter/v1 +
//   发件人 id + 收件人 id）→ AES-256-GCM，随机 12 字节 nonce，AAD = 信封头（id、from、to、sentAt、kind）；
//   整个信封再用发件人 Ed25519 签名。验签或解密不过一律当这封信不存在（调用方丢掉并记一条）。
// - 安全码：两边签名公钥按账号 id 排序拼起来 SHA-256，取十进制前 60 位，每 5 位一组；两边算出来一样。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { Envelope, EnvelopeKind } from '../shared/net-wire.ts';

export const PROTOCOL_INFO = 'cyber-hunter/v1';
const ENVELOPE_CONTEXT = `${PROTOCOL_INFO}/envelope`;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SAFETY_DIGITS = 60;
const SAFETY_GROUP = 5;

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface IdentityKeys {
  signing: KeyPair;
  encryption: KeyPair;
}

type Curve = 'Ed25519' | 'X25519';

function rawPublic(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') {
    throw new Error('导出公钥失败');
  }
  return jwk.x;
}

function pair(curve: Curve): KeyPair {
  const { publicKey, privateKey } = curve === 'Ed25519'
    ? generateKeyPairSync('ed25519')
    : generateKeyPairSync('x25519');
  return {
    publicKey: rawPublic(publicKey),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}

export function generateIdentityKeys(): IdentityKeys {
  return { signing: pair('Ed25519'), encryption: pair('X25519') };
}

function publicKeyOf(curve: Curve, raw: string): KeyObject {
  if (Buffer.from(raw, 'base64url').length !== KEY_BYTES) {
    throw new Error('公钥长度不对');
  }
  return createPublicKey({ key: { kty: 'OKP', crv: curve, x: raw }, format: 'jwk' });
}

function privateKeyOf(encoded: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'pkcs8' });
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function signText(privateKey: string, text: string | Buffer): string {
  return sign(null, Buffer.from(text), privateKeyOf(privateKey)).toString('base64url');
}

/** 公钥或签名本身不成形也只是「验不过」，不抛错：进来的东西是外部输入。 */
export function verifyText(publicKey: string, text: string | Buffer, signature: string): boolean {
  try {
    return verify(null, Buffer.from(text), publicKeyOf('Ed25519', publicKey), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export interface RequestToSign {
  method: string;
  /** pathname + search，原样。 */
  path: string;
  time: string;
  nonce: string;
  body: Buffer;
}

export function requestSigningText(request: RequestToSign): string {
  return [request.method.toUpperCase(), request.path, request.time, request.nonce, sha256Hex(request.body)].join('\n');
}

export function newNonce(): string {
  return randomBytes(18).toString('base64url');
}

type EnvelopeHead = Pick<Envelope, 'id' | 'from' | 'to' | 'sentAt' | 'kind'>;

function aadOf(head: EnvelopeHead): Buffer {
  return Buffer.from(JSON.stringify([head.id, head.from, head.to, head.sentAt, head.kind]));
}

function envelopeSigningText(envelope: Omit<Envelope, 'signature'>): string {
  return `${ENVELOPE_CONTEXT}\n${JSON.stringify([envelope.id, envelope.from, envelope.to, envelope.sentAt,
    envelope.kind, envelope.ephemeralKey, envelope.nonce, envelope.ciphertext])}`;
}

function messageKey(shared: Buffer, ephemeralKey: string, from: string, to: string): Buffer {
  const salt = Buffer.from(ephemeralKey, 'base64url');
  return Buffer.from(hkdfSync('sha256', shared, salt, `${PROTOCOL_INFO}${from}${to}`, KEY_BYTES));
}

export interface SealInput {
  id: string;
  from: string;
  to: string;
  sentAt: string;
  kind: EnvelopeKind;
  plaintext: unknown;
  recipientEncryptionKey: string;
  senderSigningPrivateKey: string;
}

export function sealEnvelope(input: SealInput): Envelope {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralKey = rawPublic(ephemeral.publicKey);
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: publicKeyOf('X25519', input.recipientEncryptionKey),
  });
  const key = messageKey(shared, ephemeralKey, input.from, input.to);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aadOf(input));
  const body = Buffer.concat([cipher.update(JSON.stringify(input.plaintext), 'utf8'), cipher.final(),
    cipher.getAuthTag()]);
  const unsigned = {
    id: input.id,
    from: input.from,
    to: input.to,
    sentAt: input.sentAt,
    kind: input.kind,
    ephemeralKey,
    nonce: nonce.toString('base64url'),
    ciphertext: body.toString('base64url'),
  };
  return signEnvelope(unsigned, input.senderSigningPrivateKey);
}

/** 给一个已经加好密的信封签名（发件人自己的钥匙）。 */
export function signEnvelope(unsigned: Omit<Envelope, 'signature'>, signingPrivateKey: string): Envelope {
  return { ...unsigned, signature: signText(signingPrivateKey, envelopeSigningText(unsigned)) };
}

export function verifyEnvelope(envelope: Envelope, senderSigningKey: string): boolean {
  const { signature, ...unsigned } = envelope;
  return verifyText(senderSigningKey, envelopeSigningText(unsigned), signature);
}

export type OpenedEnvelope = { ok: true; plaintext: unknown } | { ok: false; reason: 'signature' | 'decrypt' };

export function openEnvelope(envelope: Envelope, senderSigningKey: string, recipientEncryptionPrivateKey: string):
  OpenedEnvelope {
  if (!verifyEnvelope(envelope, senderSigningKey)) {
    return { ok: false, reason: 'signature' };
  }
  try {
    const shared = diffieHellman({
      privateKey: privateKeyOf(recipientEncryptionPrivateKey),
      publicKey: publicKeyOf('X25519', envelope.ephemeralKey),
    });
    const key = messageKey(shared, envelope.ephemeralKey, envelope.from, envelope.to);
    const body = Buffer.from(envelope.ciphertext, 'base64url');
    if (body.length < TAG_BYTES) {
      return { ok: false, reason: 'decrypt' };
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(aadOf(envelope));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
    return { ok: true, plaintext: JSON.parse(text.toString('utf8')) };
  } catch {
    // 认证标签不对、钥匙不对、明文不是 JSON：都是这封信不可信，原因只分两类，不带细节。
    return { ok: false, reason: 'decrypt' };
  }
}

export interface SafetyParty {
  accountId: string;
  signingKey: string;
}

export function safetyCode(a: SafetyParty, b: SafetyParty): string {
  const [first, second] = a.accountId <= b.accountId ? [a, b] : [b, a];
  const digest = createHash('sha256')
    .update(Buffer.from(first.signingKey, 'base64url'))
    .update(Buffer.from(second.signingKey, 'base64url'))
    .digest('hex');
  const digits = BigInt(`0x${digest}`).toString(10).padStart(SAFETY_DIGITS, '0').slice(0, SAFETY_DIGITS);
  const groups: string[] = [];
  for (let index = 0; index < SAFETY_DIGITS; index += SAFETY_GROUP) {
    groups.push(digits.slice(index, index + SAFETY_GROUP));
  }
  return groups.join(' ');
}
