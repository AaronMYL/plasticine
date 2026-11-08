// 旧版 /v2/device-keys 兼容入口，保留公钥历史、登记窗口、唯一性与请求幂等；本人确认已改用会话，不依赖这里的结果。
// 旧客户端遇到登记问题时应刷新页面使用新确认流程，不再引导用户重新配对或恢复钥匙。

import { createHash, createPublicKey } from 'node:crypto';
import {
  DEVICE_KEY_REGISTRATION_WINDOW_MS,
  RegisterDeviceKeyRequestSchema,
  type DeviceKeyResponse,
  type DeviceKeyView,
  type PublicKeyJwk,
} from '../../shared/api/index.ts';
import type { DeviceKey, PublicJwk } from '../../shared/state.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

const LEGACY_KEY_NEXT = '本人确认已不需要签名钥匙。刷新 Plasticine 页面后直接操作。';

function keyView(key: DeviceKey): DeviceKeyView {
  return { id: key.id, deviceId: key.deviceId, thumbprint: key.thumbprint, createdAt: key.createdAt };
}

/** Only the four public members are kept; `ext` and `key_ops` from WebCrypto's export are dropped. */
function publicMembers(jwk: PublicKeyJwk): PublicJwk {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** RFC 7638: SHA-256 over the required members in lexicographic order, no whitespace. */
function thumbprintOf(jwk: PublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** A key node:crypto cannot load (a point off the curve) could never verify anything: refuse it now. */
function checkLoads(jwk: PublicJwk): void {
  try {
    createPublicKey({ key: { ...jwk }, format: 'jwk' });
  } catch {
    throw new ApiError(400, 'invalid_request', '这不是一把可用的 P-256 公钥。', {
      field: 'publicKey',
      next: '用 WebCrypto 生成 ECDSA P-256 钥匙，导出公钥的 JWK 再登记。',
    });
  }
}

/** GET /v2/device-keys */
export function getDeviceKey(context: RequestContext): Reply {
  const auth = requireAuth(context);
  const key = context.deps.state.deviceKeys.liveFor(auth.device.id);
  const body: DeviceKeyResponse = { key: key === undefined ? null : keyView(key) };
  return { status: 200, body };
}

/** POST /v2/device-keys */
export async function registerDeviceKey(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  if (auth.actor === 'system') {
    throw new ApiError(403, 'user_confirmation_required', '内部浏览器不能登记个人确认钥匙。');
  }
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RegisterDeviceKeyRequestSchema, raw.value, '登记设备钥匙');
  const publicKey = publicMembers(body.publicKey);
  checkLoads(publicKey);
  const thumbprint = thumbprintOf(publicKey);
  const { state } = context.deps;
  const work = (): Reply => {
    const existing = state.deviceKeys.liveFor(auth.device.id);
    if (existing !== undefined) {
      if (existing.thumbprint === thumbprint) {
        const same: DeviceKeyResponse = { key: keyView(existing) };
        return { status: 200, body: same };
      }
      throw new ApiError(409, 'device_key_exists', '这台设备已经登记过另一把签名钥匙，没有换。', {
        next: LEGACY_KEY_NEXT,
      });
    }
    if (state.deviceKeys.liveByThumbprint(thumbprint) !== undefined) {
      throw new ApiError(409, 'device_key_exists', '这把钥匙已经是另一台还在用的设备的签名钥匙，没有登记。', {
        next: LEGACY_KEY_NEXT,
      });
    }
    const age = context.deps.now().getTime() - Date.parse(auth.session.createdAt);
    if (age > DEVICE_KEY_REGISTRATION_WINDOW_MS) {
      const minutes = DEVICE_KEY_REGISTRATION_WINDOW_MS / 60_000;
      throw new ApiError(403, 'device_key_too_late', `这台设备配对已经超过 ${minutes} 分钟，不能再登记签名钥匙。`, {
        next: LEGACY_KEY_NEXT,
      });
    }
    const key = state.deviceKeys.register({ deviceId: auth.device.id, publicKey, thumbprint });
    const created: DeviceKeyResponse = { key: keyView(key) };
    return { status: 201, body: created };
  };
  return idempotent(context, body.requestId, work, { bodyDigest: raw.digest });
}
