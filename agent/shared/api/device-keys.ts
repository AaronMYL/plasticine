// 旧版 /v2/device-keys 与签名格式留作接口兼容。本人确认已改用有效配对会话；新客户端无需生成钥匙，业务接口不验这些签名头。
// 下面记录旧协议，已有钥匙与历史保留，不再把钥匙登记结果当作任何正常业务的前置条件。
//
// Legacy signing format:
//   bodyDigest = base64url( SHA-256( the exact bytes of the request body ) )   — no padding
//   text       = signingText({ method, path, requestId, signedAt, bodyDigest })
//   signature  = base64url( ECDSA-P256-SHA256( UTF-8 bytes of text ) )            — raw r‖s, 64 bytes, as WebCrypto
//   headers    : x-plasticine-signed-at: <signedAt>   x-plasticine-signature: <signature>
// `path` is the URL path as sent, without the query; `signedAt` an ISO time within 5 minutes of the server clock;
// `requestId` the body's requestId. Resending the same request after a lost answer: sign again (new signedAt), keep
// the requestId and the body; the stored answer comes back. The same requestId with another body is refused.

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

export const DEVICE_KEYS_PATH = `${API_PREFIX}/device-keys`;

export const SIGNATURE_HEADER = 'x-plasticine-signature';
export const SIGNED_AT_HEADER = 'x-plasticine-signed-at';
/** The first line of the signed text; a new format gets a new name instead of changing this one. */
export const SIGNATURE_FORMAT = 'plasticine-device-signature-v1';
// Long enough for a phone whose clock is a little off, short enough that a captured request goes stale quickly.
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
/**
 * 旧钥匙登记接口仍保留配对后 10 分钟窗口；这只是旧协议约束，不影响本人会话确认业务操作。
 */
export const DEVICE_KEY_REGISTRATION_WINDOW_MS = 10 * 60 * 1000;

export interface SigningInput {
  method: string;
  path: string;
  requestId: string;
  signedAt: string;
  bodyDigest: string;
}

/** The text a device signs: six lines, joined with \n, no trailing newline. */
export function signingText(input: SigningInput): string {
  return [SIGNATURE_FORMAT, input.method.toUpperCase(), input.path, input.requestId, input.signedAt, input.bodyDigest]
    .join('\n');
}

const Base64Url32 = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' });

/**
 * The public key as WebCrypto exports it (`exportKey('jwk', publicKey)`). `ext` and `key_ops` may come along and are
 * dropped; a private member (`d`) is refused, so a private key can never be sent by mistake.
 */
export const PublicKeyJwkSchema = Type.Object(
  {
    kty: Type.Literal('EC'),
    crv: Type.Literal('P-256'),
    x: Base64Url32,
    y: Base64Url32,
    ext: Type.Optional(Type.Boolean()),
    key_ops: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
export type PublicKeyJwk = Static<typeof PublicKeyJwkSchema>;

/** POST /v2/device-keys → 201 DeviceKeyResponse (200 when this key is already the device's key). */
export const RegisterDeviceKeyRequestSchema = Type.Object(
  { requestId: RequestIdSchema, publicKey: PublicKeyJwkSchema },
  { additionalProperties: false },
);
export type RegisterDeviceKeyRequest = Static<typeof RegisterDeviceKeyRequestSchema>;

export const DeviceKeyViewSchema = Type.Object({
  id: IdSchema,
  deviceId: IdSchema,
  /** RFC 7638 SHA-256 thumbprint, hex. */
  thumbprint: Type.String(),
  createdAt: IsoTimeSchema,
});
export type DeviceKeyView = Static<typeof DeviceKeyViewSchema>;

/** GET /v2/device-keys: the key of the device this session belongs to, or null before it registered one. */
export const DeviceKeyResponseSchema = Type.Object({ key: Type.Union([DeviceKeyViewSchema, Type.Null()]) });
export type DeviceKeyResponse = Static<typeof DeviceKeyResponseSchema>;
