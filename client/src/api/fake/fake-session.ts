// 假的会话和设备：读当前会话、退出、设备列表和撤销。11-08 去掉配对码：登记设备、开会话由 fake-account.ts
// 建账号 / 密码登录 / 本机登录时调 signInAs。

import type { DevicesApi, SessionApi } from '../client.ts';
import { ApiError, unauthorizedError } from '../errors.ts';
import type { DeviceView, SessionView } from '../types.ts';

// 会话的有效期和真服务端一样写 400 天（浏览器 cookie 的上限），假实现里只是显示用。
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

export class FakeSession implements SessionApi, DevicesApi {
  private session: SessionView | null = null;
  private readonly devices = new Map<string, DeviceView>();
  private readonly unauthorizedListeners = new Set<() => void>();
  private sequence = 0;
  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
  }

  async current(): Promise<SessionView | null> {
    return this.session;
  }

  async logout(): Promise<void> {
    this.session = null;
  }

  async list(): Promise<DeviceView[]> {
    this.require();
    const currentId = this.session?.device.id;
    return [...this.devices.values()].map((device) => ({ ...device, current: device.id === currentId }));
  }

  async revoke(id: string): Promise<DeviceView> {
    this.require();
    const device = this.devices.get(id);
    if (device === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这台设备。', status: 404 });
    }
    const revoked = { ...device, revokedAt: device.revokedAt ?? this.now().toISOString() };
    this.devices.set(id, revoked);
    const self = this.session?.device.id === id;
    if (self) {
      this.session = null;
    }
    return { ...revoked, current: self };
  }

  /** 测试：再登记一台已登录的设备（不切换当前会话）。 */
  seedDevice(deviceName: string, via?: DeviceView['via']): DeviceView {
    const device = this.register(deviceName);
    if (via === undefined) return device;
    const seen = { ...device, via };
    this.devices.set(device.id, seen);
    return seen;
  }

  /** 建账号、密码登录（fake-account.ts）：登记这台设备并换成它的会话。 */
  signInAs(deviceName: string, local = false): SessionView {
    this.session = { ...this.open(this.register(deviceName, local)), actor: 'user' };
    return this.session;
  }

  /** 开发预置：直接有一个会话。 */
  signInForDevelopment(deviceName: string, actor: SessionView['actor'] = 'user'): void {
    this.session = { ...this.open(this.register(deviceName)), actor };
  }

  /** 服务端那一侧：会话失效（过期或被撤销）。 */
  expire(): void {
    this.session = null;
  }

  /** 现在的会话（同步读，给假的设备钥匙、签名核对用）；没有就是 null。 */
  currentSession(): SessionView | null {
    return this.session;
  }

  /** 测试：把这次会话的配对时间往前挪，模拟「配对已经超过 10 分钟」。 */
  backdate(ms: number): void {
    if (this.session === null) {
      return;
    }
    const createdAt = new Date(Date.parse(this.session.session.createdAt) - ms).toISOString();
    this.session = { ...this.session, session: { ...this.session.session, createdAt } };
  }

  /** 每个需要登录的操作先调它；没会话就通知壳并抛 401。 */
  require(): void {
    if (this.session !== null) {
      return;
    }
    for (const listener of [...this.unauthorizedListeners]) {
      listener();
    }
    throw unauthorizedError();
  }

  /** 用户确认字段只能来自本人的配对会话；内部系统会话不能冒充本人。 */
  requireUser(): void {
    this.require();
    if (this.session?.actor === 'system') {
      throw new ApiError({ kind: 'invalid', code: 'user_confirmation_required', status: 403,
        message: '这一步需要本人确认。' });
    }
  }

  onUnauthorized(listener: () => void): () => void {
    this.unauthorizedListeners.add(listener);
    return () => {
      this.unauthorizedListeners.delete(listener);
    };
  }

  private register(deviceName: string, local = false): DeviceView {
    this.sequence += 1;
    const at = this.now().toISOString();
    const device: DeviceView = {
      id: `dev_${this.sequence}`,
      name: deviceName,
      firstSeenAt: at,
      lastSeenAt: at,
      revokedAt: null,
      current: false,
      ...(local ? { local: true, via: 'local' as const } : {}),
    };
    this.devices.set(device.id, device);
    return device;
  }

  private open(device: DeviceView): SessionView {
    const at = this.now();
    const expiresAt = new Date(at.getTime() + SESSION_TTL_MS).toISOString();
    return { device: { ...device, current: true }, session: { createdAt: at.toISOString(), expiresAt } };
  }
}
