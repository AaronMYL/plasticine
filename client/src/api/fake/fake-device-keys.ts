// 假的设备钥匙：和真服务端（agent/src/app/device-keys.ts、device-signature.ts）一样——一台设备一把，只在配对后
// 10 分钟内能登记；登记按 requestId + 请求体去重；之后验每个签名请求：缺签名、没钥匙、过期、对不上都是 403，
// 什么都不写、不存回答。签名时间窗按真的钟（Date.now）算：签名的是设备的钟，不是假实现里固定的 now。

import { Value } from 'typebox/value';
import type { DeviceKeysApi } from '../client.ts';
import { importPublicJwk, thumbprintOf, verifyRequest } from '../device-signature.ts';
import { ApiError } from '../errors.ts';
import {
  DEVICE_KEY_REGISTRATION_WINDOW_MS,
  RegisterDeviceKeyRequestSchema,
  SIGNATURE_WINDOW_MS,
} from '../shared.ts';
import { SIGNED_METHOD, signedPath, type SignedSend } from '../signed-targets.ts';
import type { DeviceKeyView, PublicKeyJwk } from '../types.ts';
import type { FakeSession } from './fake-session.ts';
import { faultError, type FaultPlan } from './faults.ts';

interface Registered {
  view: DeviceKeyView;
  jwk: PublicKeyJwk;
}

const RESIGN_NEXT = '在这台设备上重新签一次再发（同一个 requestId、同样的内容）。';

function refusal(code: string, message: string, next: string = RESIGN_NEXT): ApiError {
  return new ApiError({ kind: 'invalid', code, message, next, status: 403 });
}

export interface FakeDeviceKeysDeps {
  session: FakeSession;
  faults: FaultPlan;
  now: () => Date;
}

export class FakeDeviceKeys implements DeviceKeysApi {
  private readonly keys = new Map<string, Registered>();
  private readonly answered = new Map<string, { body: string; view: DeviceKeyView }>();
  private readonly deps: FakeDeviceKeysDeps;
  private sequence = 0;

  constructor(deps: FakeDeviceKeysDeps) {
    this.deps = deps;
  }

  async current(): Promise<DeviceKeyView | null> {
    return this.keys.get(this.deviceId())?.view ?? null;
  }

  async register(bodyText: string): Promise<DeviceKeyView> {
    const deviceId = this.deviceId();
    const fault = this.deps.faults.take('register_key');
    if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
      throw faultError('register_key', fault);
    }
    const body: unknown = JSON.parse(bodyText);
    if (!Value.Check(RegisterDeviceKeyRequestSchema, body)) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', message: '登记设备钥匙：请求体不对。', status: 400 });
    }
    const view = await this.registerChecked(deviceId, body.requestId, bodyText, body.publicKey);
    if (fault !== undefined) {
      throw faultError('register_key', fault);
    }
    return view;
  }

  /** 验一次签名请求；不过就抛 403（什么都没写）。 */
  async verify(request: SignedSend): Promise<void> {
    const deviceId = this.deviceId();
    if (request.signedAt == null || request.signature == null || request.signedAt === '' || request.signature === '') {
      throw refusal('signature_required', '这一步改的是要你确认的内容，请求里没有这台设备的签名，没有执行。');
    }
    const key = this.keys.get(deviceId);
    if (key === undefined) {
      const next = '先在这台设备上登记签名钥匙；钥匙丢了就重新配对这台设备。';
      throw refusal('device_key_missing', '这台设备还没有登记签名钥匙，不能确认这一步。', next);
    }
    const at = Date.parse(request.signedAt);
    if (Number.isNaN(at) || Math.abs(Date.now() - at) > SIGNATURE_WINDOW_MS) {
      throw refusal('signature_expired', '这次签名已经过期，没有执行。');
    }
    const requestId = this.requestIdOf(request.bodyText);
    const input = { method: SIGNED_METHOD, path: signedPath(request.target), requestId, bodyText: request.bodyText };
    const publicKey = await importPublicJwk(key.jwk);
    if (!(await verifyRequest(publicKey, { ...input, signedAt: request.signedAt }, request.signature))) {
      throw refusal('signature_invalid', '签名和这台设备登记的钥匙对不上，没有执行。');
    }
  }

  private async registerChecked(
    deviceId: string,
    requestId: string,
    bodyText: string,
    jwk: PublicKeyJwk,
  ): Promise<DeviceKeyView> {
    const replay = this.answered.get(requestId);
    if (replay !== undefined) {
      if (replay.body !== bodyText) {
        throw new ApiError({
          kind: 'failed',
          code: 'request_id_reused',
          message: '这个 request_id 已经用过了，这次带的内容和上次不一样，没有执行。',
          status: 409,
        });
      }
      return replay.view;
    }
    const thumbprint = await thumbprintOf(jwk);
    const existing = this.keys.get(deviceId);
    if (existing !== undefined) {
      if (existing.view.thumbprint === thumbprint) {
        return existing.view;
      }
      throw new ApiError({
        kind: 'failed',
        code: 'device_key_exists',
        message: '这台设备已经登记过另一把签名钥匙，没有换。',
        next: '钥匙丢了（清了浏览器数据）就重新配对这台设备。',
        status: 409,
      });
    }
    const session = this.deps.session.currentSession();
    const age = session === null ? 0 : this.deps.now().getTime() - Date.parse(session.session.createdAt);
    if (age > DEVICE_KEY_REGISTRATION_WINDOW_MS) {
      throw refusal(
        'device_key_too_late',
        '这台设备配对已经超过 10 分钟，不能再登记签名钥匙。',
        '在服务器上生成配对码重新配对这台设备，配对后马上登记钥匙。',
      );
    }
    this.sequence += 1;
    const view = { id: `key_${this.sequence}`, deviceId, thumbprint, createdAt: this.deps.now().toISOString() };
    this.keys.set(deviceId, { view, jwk });
    this.answered.set(requestId, { body: bodyText, view });
    return view;
  }

  private deviceId(): string {
    this.deps.session.require();
    const session = this.deps.session.currentSession();
    if (session === null) {
      throw new Error('require() 之后应当有会话');
    }
    return session.device.id;
  }

  private requestIdOf(bodyText: string): string {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body === 'object' && body !== null && 'requestId' in body && typeof body.requestId === 'string') {
      return body.requestId;
    }
    throw new ApiError({ kind: 'invalid', code: 'invalid_request', message: '请求体里没有 requestId。', status: 400 });
  }
}
