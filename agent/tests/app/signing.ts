// A test device's signing key and signed requests, built the way shared/api/device-keys.ts tells a client to: an
// ECDSA P-256 key, the SHA-256 of the exact body bytes, the six-line signing text, a raw r‖s signature.
// node:crypto stands in for the browser's WebCrypto; the bytes on the wire are the same.

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  DEVICE_KEYS_PATH,
  SIGNATURE_HEADER,
  SIGNED_AT_HEADER,
  signingText,
  type PublicKeyJwk,
} from '../../shared/api/index.ts';
import { call, type ApiReply, type TestApp } from './helpers.ts';

export interface TestDeviceKey {
  publicJwk: PublicKeyJwk;
  privateKey: KeyObject;
}

export function newDeviceKey(): TestDeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { publicJwk: { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) }, privateKey };
}

let counter = 0;
/** A fresh request id that fits RequestIdSchema. */
export function newRequestId(prefix = 'req'): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(8, '0')}`;
}

export async function registerKey(t: TestApp, cookie: string, key: TestDeviceKey): Promise<ApiReply> {
  const body = { requestId: newRequestId('key'), publicKey: key.publicJwk };
  return call(t, 'POST', DEVICE_KEYS_PATH, { cookie, body });
}

export interface SignedOptions {
  cookie: string;
  key: TestDeviceKey;
  /** Default: the test clock's now. */
  signedAt?: string;
  /** Sign this body text instead of the one sent (a tampered request). */
  signedBody?: string;
  /** Sign for this path instead of the one called. */
  signedPath?: string;
  /** Send without the signature headers. */
  unsigned?: boolean;
}

export function signatureHeaders(
  key: TestDeviceKey,
  input: { method: string; path: string; requestId: string; body: string; signedAt: string },
): Record<string, string> {
  const bodyDigest = createHash('sha256').update(input.body, 'utf8').digest('base64url');
  const text = signingText({ ...input, bodyDigest });
  const signature = sign('sha256', Buffer.from(text, 'utf8'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return { [SIGNED_AT_HEADER]: input.signedAt, [SIGNATURE_HEADER]: signature.toString('base64url') };
}

/** `body` must carry its requestId; `call` sends JSON.stringify(body), the same bytes signed here. */
export async function signedCall(
  t: TestApp,
  method: string,
  path: string,
  body: Record<string, unknown>,
  options: SignedOptions,
): Promise<ApiReply> {
  const sent = JSON.stringify(body);
  const headers = options.unsigned === true
    ? {}
    : signatureHeaders(options.key, {
      method,
      path: options.signedPath ?? path,
      requestId: String(body['requestId']),
      body: options.signedBody ?? sent,
      signedAt: options.signedAt ?? t.clock.now().toISOString(),
    });
  return call(t, method, path, { cookie: options.cookie, body, headers });
}
