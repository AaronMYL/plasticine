// 假的推送登记：一个固定的公钥（形状对、不是真钥匙），订阅按 endpoint 一行，退订说删没删。

import type { PushApi } from '../client.ts';
import type {
  PushKeyResponse,
  SubscribePushRequest,
  SubscribePushResponse,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
} from '../types.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';
import type { PushStatus, PushTestResponse } from '../shared.ts';

/** 未压缩的 P-256 公钥是 65 字节，base64url 87 个字符；假的就是 0x04 开头、其余全 0。 */
export const FAKE_VAPID_PUBLIC_KEY = `BA${'A'.repeat(85)}`;

export interface FakePushDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
}

export class FakePush implements PushApi {
  private readonly owners = new Map<string, string>();
  private readonly endpoints = new Map<string, SubscribePushResponse['subscription']>();
  private readonly deps: FakePushDeps;
  private sequence = 0;

  constructor(deps: FakePushDeps) {
    this.deps = deps;
  }

  async key(): Promise<PushKeyResponse> {
    this.deps.session.require();
    return { publicKey: FAKE_VAPID_PUBLIC_KEY };
  }

  async status(): Promise<PushStatus> {
    this.deps.session.require();
    const deviceId = this.deps.session.currentSession()?.device.id;
    return { subscribed: [...this.endpoints.keys()].some((endpoint) => this.owners.get(endpoint) === deviceId) };
  }

  async subscribe(input: SubscribePushRequest): Promise<SubscribePushResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('push', input.requestId, 'POST /v2/push/subscriptions', () => {
      this.owners.set(input.endpoint, this.deps.session.currentSession()?.device.id ?? '');
      const existing = this.endpoints.get(input.endpoint);
      if (existing !== undefined) {
        return { subscription: existing };
      }
      this.sequence += 1;
      const subscription = {
        id: `push_${this.sequence}`,
        endpointHost: new URL(input.endpoint).host,
        createdAt: this.deps.now().toISOString(),
        lastSentAt: null,
      };
      this.endpoints.set(input.endpoint, subscription);
      return { subscription };
    });
  }

  async unsubscribe(input: UnsubscribePushRequest): Promise<UnsubscribePushResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('push', input.requestId, 'DELETE /v2/push/subscriptions', () => ({
      removed: this.endpoints.delete(input.endpoint),
    }));
  }

  /** 假实现里没有推送服务：这台设备订阅了就当发出去了。 */
  async test(): Promise<PushTestResponse> {
    this.deps.session.require();
    const deviceId = this.deps.session.currentSession()?.device.id;
    const mine = [...this.endpoints.keys()].filter((endpoint) => this.owners.get(endpoint) === deviceId).length;
    return mine === 0 ? { sent: 0, error: '这台设备还没打开系统通知' } : { sent: mine, error: null };
  }

  /** 测试用：最近报过的「正在看哪段对话」。 */
  watching: string | null = null;

  async presence(conversation: string | null): Promise<void> {
    this.deps.session.require();
    this.watching = conversation;
  }

  /** 测试用：服务端现在登记着的 endpoint。 */
  subscribed(): string[] {
    return [...this.endpoints.keys()];
  }
}
