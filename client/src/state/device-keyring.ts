// 历史设备签名协议的兼容实现，为旧记录和旧接口保留。当前 App 不初始化或调用它；正常启动、笔记读取和本人确认均不依赖它。
// 旧协议由 prepare 生成并登记钥匙，再用它签名；以下状态和错误文案仅供兼容，不是当前用户操作的前置条件。
// 旧钥匙在 DeviceKeyStore（浏览器里是 IndexedDB）里，是不可导出的 CryptoKey；不写进 sessionStorage、localStorage 或日志。

import type { DeviceKeysApi } from '../api/client.ts';
import type { DeviceKeyStore, StoredDeviceKey } from '../api/device-key-store.ts';
import {
  generateDeviceKeyPair,
  publicJwkOf,
  signRequest,
  thumbprintOf,
  type SignInput,
} from '../api/device-signature.ts';
import { ApiError, errorText, noSigningKeyError } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { Store } from './store.ts';

export type MissingReason = 'too_late' | 'other_key';

export type KeyringStatus =
  | { kind: 'checking' }
  | { kind: 'ready'; thumbprint: string }
  /** 这台设备签不了：配对超过 10 分钟没登记过，或服务端认的是另一把。只能重新配对。 */
  | { kind: 'missing'; reason: MissingReason }
  /** 浏览器没有 IndexedDB 或 WebCrypto。 */
  | { kind: 'unsupported' }
  /** 登记没成（断网、回执丢了、服务出错）：可以再试，用的还是同一个请求体。 */
  | { kind: 'error'; message: string };

// 旧签名协议的提示文案，保留原文以兼容历史状态；不代表当前功能仍有签名或解锁门槛。
const SIGNED_THINGS = '授权设备动作、恢复备份、解锁私密笔记';
export const NO_SIGNING_KEY_TEXT = `这台设备没有签名钥匙，重新配对后才能${SIGNED_THINGS}。`;
const NO_SIGNING_KEY_NEXT = '在服务器上生成配对码，重新配对这台设备；配对后会马上登记新钥匙。';

/** 界面就地说明用的一句：为什么这台设备现在签不了。就绪时是 null。 */
export function keyringNotice(status: KeyringStatus): string | null {
  switch (status.kind) {
    case 'ready':
      return null;
    case 'checking':
      return '正在准备这台设备的签名钥匙…';
    case 'missing':
      return NO_SIGNING_KEY_TEXT;
    case 'unsupported':
      return `这个浏览器存不了签名钥匙（没有 IndexedDB 或 WebCrypto），${SIGNED_THINGS}要换一台设备。`;
    case 'error':
      return `签名钥匙还没登记上：${status.message}`;
  }
}

export class DeviceKeyring {
  readonly status: Store<KeyringStatus>;
  private readonly keys: DeviceKeyStore | null;
  private readonly lock: KeyLock;
  private ready: StoredDeviceKey | null = null;
  private preparing: { deviceId: string; done: Promise<void> } | null = null;

  constructor(keys: DeviceKeyStore | null, lock: KeyLock = browserKeyLock()) {
    this.keys = keys;
    this.lock = lock;
    this.status = new Store<KeyringStatus>(keys === null ? { kind: 'unsupported' } : { kind: 'checking' });
  }

  /** 有了会话就调；同一台设备正在准备时不重复做。 */
  prepare(api: DeviceKeysApi, deviceId: string): Promise<void> {
    if (this.preparing !== null && this.preparing.deviceId === deviceId) {
      return this.preparing.done;
    }
    const done = this.run(api, deviceId).finally(() => {
      if (this.preparing?.done === done) {
        this.preparing = null;
      }
    });
    this.preparing = { deviceId, done };
    return done;
  }

  /** 服务端说这台设备没有登记的钥匙（403 device_key_missing）：手里这把不算数了。 */
  markMissing(): void {
    this.ready = null;
    this.status.set({ kind: 'missing', reason: 'other_key' });
  }

  /** 签一次；每次重签都用新的 signedAt。没就绪就不签，抛 device_key_missing（请求不发出去）。 */
  async sign(input: Omit<SignInput, 'signedAt'>, now: Date): Promise<{ signedAt: string; signature: string }> {
    const status = this.status.get();
    if (status.kind === 'checking' || status.kind === 'error') {
      const message = `${keyringNotice(status) ?? NO_SIGNING_KEY_TEXT}这次没有发出去。`;
      throw noSigningKeyError(message, '等签名钥匙准备好，再点「重发」，用的还是同一个标识。');
    }
    if (this.ready === null || status.kind !== 'ready') {
      throw noSigningKeyError(keyringNotice(status) ?? NO_SIGNING_KEY_TEXT, NO_SIGNING_KEY_NEXT);
    }
    const signedAt = now.toISOString();
    const signature = await signRequest(this.ready.privateKey, { ...input, signedAt });
    return { signedAt, signature };
  }

  private async run(api: DeviceKeysApi, deviceId: string): Promise<void> {
    if (this.keys === null) {
      this.status.set({ kind: 'unsupported' });
      return;
    }
    const keys = this.keys;
    this.ready = null;
    this.status.set({ kind: 'checking' });
    try {
      // 跨标签页排队（有 navigator.locks 就用它）：同一个浏览器里只有一个标签页在取用、生成、登记钥匙；没有锁时
      // 靠 claim 在一个 IndexedDB 事务里「读不到才写」，后到的那个用先到的那把（审查 5087993 P2）。
      await this.lock(async () => {
        let key = await keys.load();
        if (key === null || key.deviceId !== deviceId) {
          key = await keys.claim(await this.create(deviceId));
        }
        await this.settle(api, key);
      });
    } catch (cause) {
      console.warn('签名钥匙没准备好', errorText(cause));
      this.status.set({ kind: 'error', message: errorText(cause) });
    }
  }

  private async create(deviceId: string): Promise<StoredDeviceKey> {
    const pair = await generateDeviceKeyPair();
    const publicJwk = await publicJwkOf(pair.publicKey);
    const registerBody = JSON.stringify({ requestId: createRequestId(), publicKey: publicJwk });
    const key: StoredDeviceKey = {
      deviceId,
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      publicJwk,
      registerBody,
      state: 'pending',
    };
    return key;
  }

  private async settle(api: DeviceKeysApi, key: StoredDeviceKey): Promise<void> {
    if (key.state === 'too_late') {
      this.status.set({ kind: 'missing', reason: 'too_late' });
      return;
    }
    const thumbprint = await thumbprintOf(key.publicJwk);
    const onServer = await api.current();
    if (onServer !== null) {
      if (onServer.thumbprint !== thumbprint) {
        this.status.set({ kind: 'missing', reason: 'other_key' });
        return;
      }
      await this.becomeReady(key, thumbprint);
      return;
    }
    try {
      await api.register(key.registerBody);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'device_key_too_late') {
        await this.save({ ...key, state: 'too_late' });
        this.status.set({ kind: 'missing', reason: 'too_late' });
        return;
      }
      if (cause instanceof ApiError && cause.code === 'device_key_exists') {
        this.status.set({ kind: 'missing', reason: 'other_key' });
        return;
      }
      throw cause;
    }
    await this.becomeReady(key, thumbprint);
  }

  private async becomeReady(key: StoredDeviceKey, thumbprint: string): Promise<void> {
    const registered: StoredDeviceKey = { ...key, state: 'registered' };
    if (key.state !== 'registered') {
      await this.save(registered);
    }
    this.ready = registered;
    this.status.set({ kind: 'ready', thumbprint });
  }

  /** 只改状态：存着的还是这把钥匙才写（别的标签页换了新钥匙就不覆盖）。 */
  private async save(key: StoredDeviceKey): Promise<void> {
    if (this.keys === null) {
      return;
    }
    await this.keys.update(key);
  }
}

/** 一次取用 / 生成 / 登记钥匙在锁里做。 */
export type KeyLock = (run: () => Promise<void>) => Promise<void>;

const LOCK_NAME = 'plasticine-device-key';

/** 浏览器里有 Web Locks 就用它跨标签页排队；没有（旧浏览器、测试环境）就直接做，原子性靠 store.claim。 */
export function browserKeyLock(): KeyLock {
  return async (run) => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks === undefined || typeof locks.request !== 'function') {
      await run();
      return;
    }
    await locks.request(LOCK_NAME, run);
  };
}
