// 设备签名的格式（shared/api/device-keys.ts）：客户端签出来的，按 signingText 重建同一段文字就能用登记的公钥验过。
// 验签这里不用客户端自己的 verify：直接拿 WebCrypto 按服务端的做法再算一遍。

import { describe, expect, it } from 'vitest';
import {
  base64UrlOf,
  bodyDigestOf,
  generateDeviceKeyPair,
  publicJwkOf,
  signRequest,
  thumbprintOf,
} from '../../src/api/device-signature.ts';
import { PublicKeyJwkSchema, signingText } from '../../src/api/shared.ts';
import { Value } from 'typebox/value';

const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const;

function bytesOf(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

describe('设备签名的格式', () => {
  it('bodyDigest 是实际请求体字节的 SHA-256，base64url 不补等号', async () => {
    const body = '{"requestId":"req_12345678","p":0.7,"reason":"中文也一样"}';
    const digest = await bodyDigestOf(body);
    const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    expect(digest).toBe(base64UrlOf(expected));
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('签名是 r‖s 64 字节转 base64url；按 signingText 重建的文字能用公钥验过', async () => {
    const pair = await generateDeviceKeyPair();
    const bodyText = '{"requestId":"req_abcdefgh","version":3,"p":0.42,"reason":"新证据"}';
    const signedAt = '2026-10-27T02:00:00.000Z';
    const input = { method: 'POST', path: '/v2/judgments/j_1/p', requestId: 'req_abcdefgh', bodyText, signedAt };
    const signature = await signRequest(pair.privateKey, input);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(bytesOf(signature).byteLength).toBe(64);

    const text = signingText({
      method: 'post',
      path: input.path,
      requestId: input.requestId,
      signedAt,
      bodyDigest: await bodyDigestOf(bodyText),
    });
    const verify = (signed: string): Promise<boolean> =>
      crypto.subtle.verify(ECDSA, pair.publicKey, bytesOf(signature), new TextEncoder().encode(signed));
    expect(await verify(text)).toBe(true);
    const otherBody = await bodyDigestOf(bodyText.replace('0.42', '0.43'));
    expect(await verify(signingText({ ...input, method: 'POST', bodyDigest: otherBody }))).toBe(false);
  });

  it('私钥不可导出；交给服务端的公钥 JWK 只有公开的几样，过得了 shared 的 schema', async () => {
    const pair = await generateDeviceKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    const jwk = await publicJwkOf(pair.publicKey);
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(Value.Check(PublicKeyJwkSchema, jwk)).toBe(true);
    expect(JSON.stringify(jwk)).not.toContain('"d"');
  });

  it('指纹是 RFC 7638 的 SHA-256 十六进制：只看四个公开成员，顺序固定', async () => {
    const pair = await generateDeviceKeyPair();
    const jwk = await publicJwkOf(pair.publicKey);
    const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
    const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(await thumbprintOf(jwk)).toBe(hex);
  });
});
