// 假的配对码登录：服务端生成一次性配对码，设备输入后拿到长期会话（第 90 条 ②）。
// 配对码只在内存里，用一次就作废。和真服务端一样：带 requestId 的配对，同一 requestId + 同一个码
// 在 10 分钟内重发，给那次登记的设备再开一个会话，不新建设备；换了 requestId 就是码用过了。

import type { DevicesApi, SessionApi } from '../client.ts';
import { ApiError, unauthorizedError } from '../errors.ts';
import { PAIRING_REPLAY_WINDOW_MS, type BrowserPairingCodeResponse, type BrowserPairingStatus } from '../shared.ts';
import type { DeviceView, PairDeviceRequest, SessionView } from '../types.ts';
import { faultError, type FaultPlan } from './faults.ts';

/** 一次带 requestId 的配对登记了哪台设备，用的哪个码。 */
interface PairingRecord {
  code: string;
  deviceId: string;
  at: number;
}

interface Invitation extends BrowserPairingCodeResponse {
  deviceId: string | null;
}

// 与服务端相同的八位 Crockford 字母数字；假的值只按序号生成，测试不用随机猜。
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_STRIDE = 7919;
// 会话的有效期和真服务端一样写 400 天（浏览器 cookie 的上限），假实现里只是显示用。
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

export class FakeSession implements SessionApi, DevicesApi {
  private session: SessionView | null = null;
  private readonly codes = new Map<string, Invitation>();
  private readonly devices = new Map<string, DeviceView>();
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly unauthorizedListeners = new Set<() => void>();
  private sequence = 0;
  private readonly now: () => Date;
  private readonly faults: FaultPlan | null;

  constructor(now: () => Date, faults: FaultPlan | null = null) {
    this.now = now;
    this.faults = faults;
  }

  async current(): Promise<SessionView | null> {
    return this.session;
  }

  async pair(input: PairDeviceRequest): Promise<SessionView> {
    const fault = this.faults?.take('pair');
    if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
      throw faultError('pair', fault);
    }
    const code = normalizeCode(input.code);
    const replayed = this.replay(input.requestId, code);
    const invitation = this.codes.get(code);
    if (replayed !== undefined) {
      this.session = replayed;
    } else if (invitation !== undefined && invitation.deviceId === null
      && Date.parse(invitation.expiresAt) > this.now().getTime()) {
      this.session = this.open(this.register(input.deviceName));
      invitation.deviceId = this.session.device.id;
      if (input.requestId !== undefined) {
        this.pairings.set(input.requestId, { code, deviceId: this.session.device.id, at: this.now().getTime() });
      }
    } else {
      throw new ApiError({
        kind: 'invalid',
        code: invitation !== undefined && Date.parse(invitation.expiresAt) <= this.now().getTime()
          ? 'pairing_code_expired' : 'pairing_code_invalid',
        message: invitation !== undefined && Date.parse(invitation.expiresAt) <= this.now().getTime()
          ? '这份配对邀请已过期。' : '配对码不对或已经用过。',
        next: '在原设备重新生成配对邀请。',
        field: 'code',
        status: 401,
      });
    }
    if (fault !== undefined) {
      // 回执丢了，但配对已经落地：码用掉了，设备登记了。
      throw faultError('pair', fault);
    }
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

  async issuePairingCode(): Promise<BrowserPairingCodeResponse> {
    this.require();
    const invitation = this.newInvitation();
    return { id: invitation.id, code: invitation.code, issuedAt: invitation.issuedAt,
      expiresAt: invitation.expiresAt };
  }

  async pairingStatus(id: string): Promise<BrowserPairingStatus> {
    this.require();
    const invitation = [...this.codes.values()].find((entry) => entry.id === id);
    if (invitation === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有这份配对邀请。', status: 404 });
    }
    const device = invitation.deviceId === null ? undefined : this.devices.get(invitation.deviceId);
    let status: BrowserPairingStatus['status'] = 'waiting';
    if (invitation.deviceId !== null) {
      status = device !== undefined && device.revokedAt === null ? 'connected' : 'revoked';
    } else if (Date.parse(invitation.expiresAt) <= this.now().getTime()) {
      status = 'expired';
    }
    return { id, expiresAt: invitation.expiresAt, checkedAt: this.now().toISOString(), status,
      device: status === 'connected' && device !== undefined
        ? { ...device, current: device.id === this.session?.device.id } : null };
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

  /** 服务端那一侧：生成一个一次性配对码。 */
  issueCode(): string {
    return this.newInvitation().code;
  }

  private newInvitation(): Invitation {
    this.sequence += 1;
    let value = this.sequence * CODE_STRIDE;
    let raw = '';
    for (let digit = 0; digit < 8; digit += 1) {
      raw = CODE_ALPHABET[value % CODE_ALPHABET.length] + raw;
      value = Math.floor(value / CODE_ALPHABET.length);
    }
    const invitation: Invitation = { id: `pair_${this.sequence}`, code: `${raw.slice(0, 4)}-${raw.slice(4)}`,
      issuedAt: this.now().toISOString(),
      expiresAt: new Date(this.now().getTime() + PAIRING_REPLAY_WINDOW_MS).toISOString(), deviceId: null };
    this.codes.set(raw, invitation);
    return invitation;
  }

  /** 测试：再登记一台已配对的设备（不切换当前会话）。 */
  seedDevice(deviceName: string): DeviceView {
    return this.register(deviceName);
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

  /** 同一次配对的重发：那台设备还在（没撤销）就再开一个会话。 */
  private replay(requestId: string | undefined, code: string): SessionView | undefined {
    if (requestId === undefined) {
      return undefined;
    }
    const record = this.pairings.get(requestId);
    if (record === undefined || this.now().getTime() - record.at > PAIRING_REPLAY_WINDOW_MS) {
      return undefined;
    }
    if (record.code !== code) {
      throw new ApiError({
        kind: 'failed',
        code: 'request_id_reused',
        message: '这个 request_id 已经用在另一个操作上了。',
        field: 'requestId',
        status: 409,
      });
    }
    const device = this.devices.get(record.deviceId);
    return device === undefined || device.revokedAt !== null ? undefined : this.open(device);
  }

  private register(deviceName: string): DeviceView {
    this.sequence += 1;
    const at = this.now().toISOString();
    const device: DeviceView = {
      id: `dev_${this.sequence}`,
      name: deviceName,
      firstSeenAt: at,
      lastSeenAt: at,
      revokedAt: null,
      current: false,
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

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
