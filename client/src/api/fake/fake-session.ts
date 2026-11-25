import type { DevicesApi, SessionApi } from '../client.ts';
import { ApiError, unauthorizedError } from '../errors.ts';
import type { DeviceView, SessionView } from '../types.ts';

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

  seedDevice(deviceName: string, via?: DeviceView['via']): DeviceView {
    const device = this.register(deviceName);
    if (via === undefined) return device;
    const seen = { ...device, via };
    this.devices.set(device.id, seen);
    return seen;
  }

  signInAs(deviceName: string, local = false): SessionView {
    this.session = { ...this.open(this.register(deviceName, local)), actor: 'user' };
    return this.session;
  }

  signInForDevelopment(deviceName: string, actor: SessionView['actor'] = 'user'): void {
    this.session = { ...this.open(this.register(deviceName)), actor };
  }

  expire(): void {
    this.session = null;
  }

  currentSession(): SessionView | null {
    return this.session;
  }

  backdate(ms: number): void {
    if (this.session === null) {
      return;
    }
    const createdAt = new Date(Date.parse(this.session.session.createdAt) - ms).toISOString();
    this.session = { ...this.session, session: { ...this.session.session, createdAt } };
  }

  require(): void {
    if (this.session !== null) {
      return;
    }
    for (const listener of [...this.unauthorizedListeners]) {
      listener();
    }
    throw unauthorizedError();
  }

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
