// 设备签名（第 90 条 ②，《实施方案》第 5 节约定 4）：格式在 shared/api/device-keys.ts，这里只照着算。
//   bodyDigest = base64url(SHA-256(实际发出的请求体字节))，不补 =
//   签名       = ECDSA-P256-SHA256(signingText(...) 的 UTF-8 字节)，WebCrypto 给的就是 r‖s 64 字节，转 base64url
// 钥匙由 WebCrypto 生成、extractable: false：私钥字节谁都拿不到，只能拿 CryptoKey 对象去签；公钥导出成 JWK 交给
// 服务端登记，只留四个公开成员。

import { Value } from 'typebox/value';
import { PublicKeyJwkSchema, signingText, type PublicKeyJwk } from './shared.ts';

const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface SignInput {
  method: string;
  /** 发出去的 URL 路径，不带查询串；和服务端 url.pathname 一字不差。 */
  path: string;
  requestId: string;
  /** 实际发出的请求体：签的是它的字节，发的也必须是它。 */
  bodyText: string;
  /** UTC 毫秒 ISO（toISOString），服务端只认 5 分钟内的。 */
  signedAt: string;
}

export function base64UrlOf(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesOfBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  // 复制进一个普通 ArrayBuffer：subtle 的参数类型不收 SharedArrayBuffer 背书的视图。
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
}

export async function bodyDigestOf(bodyText: string): Promise<string> {
  return base64UrlOf(await crypto.subtle.digest('SHA-256', utf8(bodyText)));
}

async function textToSign(input: SignInput): Promise<Uint8Array<ArrayBuffer>> {
  const bodyDigest = await bodyDigestOf(input.bodyText);
  return utf8(signingText({ ...input, bodyDigest }));
}

/** 这次请求的签名（x-plasticine-signature 的值）。 */
export async function signRequest(privateKey: CryptoKey, input: SignInput): Promise<string> {
  return base64UrlOf(await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, await textToSign(input)));
}

/** 用公钥验一次签名：假服务端用它，和真服务端（node:crypto）是同一个算法。 */
export async function verifyRequest(publicKey: CryptoKey, input: SignInput, signature: string): Promise<boolean> {
  return crypto.subtle.verify(SIGN_ALGORITHM, publicKey, bytesOfBase64Url(signature), await textToSign(input));
}

/** 新的一对钥匙：私钥不可导出（extractable: false），只能拿来签。 */
export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify']);
}

/** 公钥导出成 JWK，只留 kty / crv / x / y；导出的东西不合 shared 的 schema 就不用。 */
export async function publicJwkOf(publicKey: CryptoKey): Promise<PublicKeyJwk> {
  if (publicKey.type !== 'public') {
    throw new Error('只导出公钥：给的不是公钥');
  }
  const exported = await crypto.subtle.exportKey('jwk', publicKey);
  const jwk = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
  if (!Value.Check(PublicKeyJwkSchema, jwk)) {
    throw new Error('浏览器导出的公钥不是 P-256 的 JWK');
  }
  return jwk;
}

/** 服务端存下的公钥 JWK → CryptoKey（假服务端验签用）。 */
export async function importPublicJwk(jwk: PublicKeyJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { ...jwk, ext: true }, KEY_ALGORITHM, true, ['verify']);
}

/** RFC 7638 指纹（SHA-256，十六进制），和服务端登记时算的一样：用来认出服务端那把是不是这一把。 */
export async function thumbprintOf(jwk: PublicKeyJwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(canonical)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
